import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GitRefSync,
  type GitRefSyncCommand,
  type GitRefSyncCommandResult,
  type GitRefSyncCommandRunner
} from "./gitRefSync.js";

class SpawnGitRefSyncRunner implements GitRefSyncCommandRunner {
  run(command: GitRefSyncCommand): Promise<GitRefSyncCommandResult> {
    if (command.kind !== "git") {
      throw new Error(`unexpected ${command.kind} command`);
    }

    return runGit(command.args, command.cwd);
  }
}

class CapturingGitRefSyncRunner implements GitRefSyncCommandRunner {
  readonly commands: GitRefSyncCommand[] = [];

  async run(command: GitRefSyncCommand): Promise<GitRefSyncCommandResult> {
    this.commands.push(command);

    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

class FailingPushRunner implements GitRefSyncCommandRunner {
  readonly commands: GitRefSyncCommand[] = [];

  async run(command: GitRefSyncCommand): Promise<GitRefSyncCommandResult> {
    this.commands.push(command);

    if (command.kind === "git" && command.args[0] === "push") {
      return { exitCode: 1, stdout: "", stderr: "non-fast-forward\n" };
    }

    const joined = command.kind === "git" ? command.args.join(" ") : "";

    if (joined === "rev-parse --show-toplevel") {
      return { exitCode: 0, stdout: "/repo\n", stderr: "" };
    }

    if (joined === "config --get remote.origin.url") {
      return { exitCode: 0, stdout: "git@example.com:owner/repo.git\n", stderr: "" };
    }

    if (joined === "rev-parse HEAD") {
      return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
    }

    if (joined === "status --porcelain=v1 -z") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("GitRefSync", () => {
  it("pushes a deterministic Worker ref from a clean local workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-git-ref-sync-"));
    const bare = join(dir, "origin.git");
    const workspace = join(dir, "workspace");
    const workerName = "agent-fleet-remote-git-ref-sync-remote-202604262208";

    try {
      await createBareOriginAndClone({ bare, workspace });
      const baseSha = (await runGit(["rev-parse", "HEAD"], workspace)).stdout.trim();
      const sync = new GitRefSync(new SpawnGitRefSyncRunner());

      const result = await sync.prepareOutbound({
        workspacePath: workspace,
        workerName
      });

      expect(result.status).toBe("prepared");
      expect(result.baseSha).toBe(baseSha);
      expect(result.workerBranch).toBe(`agent-fleet/workers/${workerName}`);
      expect(result.workerRef).toBe(`refs/heads/agent-fleet/workers/${workerName}`);
      expect(result.returnedBranch).toBe(`agent-fleet/results/${workerName}`);
      expect(result.returnedRef).toBe(`refs/heads/agent-fleet/results/${workerName}`);

      const pushedSha = (
        await runGit(["--git-dir", bare, "rev-parse", `refs/heads/agent-fleet/workers/${workerName}`])
      ).stdout.trim();
      expect(pushedSha).toBe(baseSha);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks outbound sync when porcelain status reports a dirty worktree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-git-ref-sync-"));
    const bare = join(dir, "origin.git");
    const workspace = join(dir, "workspace");
    const workerName = "agent-fleet-dirty-worktree-remote-202604262208";

    try {
      await createBareOriginAndClone({ bare, workspace });
      await writeFile(join(workspace, "dirty.txt"), "uncommitted\n");
      const sync = new GitRefSync(new SpawnGitRefSyncRunner());

      const result = await sync.prepareOutbound({
        workspacePath: workspace,
        workerName
      });

      expect(result.status).toBe("blocked");
      expect(result.summary).toContain("dirty worktree");
      const missingRef = await runGit([
        "--git-dir",
        bare,
        "show-ref",
        "--verify",
        `refs/heads/agent-fleet/workers/${workerName}`
      ]);
      expect(missingRef.exitCode).not.toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("generates a shell-quoted remote scratch checkout script for the Worker ref", async () => {
    const runner = new CapturingGitRefSyncRunner();
    const sync = new GitRefSync(runner);
    const workerName = "agent-fleet-remote-git-ref-sync-remote-202604262208";

    const result = await sync.prepareRemoteScratch({
      sshHost: "builder@example-host.example",
      originUrl: "git@example.com:owner/repo's.git",
      remoteWorkspacePath: "/srv/agent-fleet/repo's checkout",
      workerBranch: `agent-fleet/workers/${workerName}`,
      workerRef: `refs/heads/agent-fleet/workers/${workerName}`
    });

    expect(result.status).toBe("prepared");
    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0]).toMatchObject({
      kind: "ssh",
      sshHost: "builder@example-host.example"
    });
    const script = runner.commands[0].kind === "ssh" ? runner.commands[0].remoteScript : "";
    expect(script).toContain("set -eu");
    expect(script).toContain("mkdir -p '/srv/agent-fleet'");
    expect(script).toContain("git clone --no-checkout 'git@example.com:owner/repo'\\''s.git' '/srv/agent-fleet/repo'\\''s checkout'");
    expect(script).toContain(
      "git fetch origin '+refs/heads/agent-fleet/workers/agent-fleet-remote-git-ref-sync-remote-202604262208:refs/remotes/origin/agent-fleet/workers/agent-fleet-remote-git-ref-sync-remote-202604262208'"
    );
    expect(script).toContain(
      "git checkout -B 'agent-fleet/workers/agent-fleet-remote-git-ref-sync-remote-202604262208' FETCH_HEAD"
    );
  });

  it("can inject a GIT_SSH_COMMAND for remote clone and fetch without writing ssh config", async () => {
    const runner = new CapturingGitRefSyncRunner();
    const sync = new GitRefSync(runner);
    const workerName = "agent-fleet-remote-git-ref-sync-remote-202604262208";

    const result = await sync.prepareRemoteScratch({
      sshHost: "builder@example-host.example",
      originUrl: "git@github.com:owner/repo.git",
      remoteWorkspacePath: "/tmp/agent-fleet/work/owner-repo",
      workerBranch: `agent-fleet/workers/${workerName}`,
      workerRef: `refs/heads/agent-fleet/workers/${workerName}`,
      gitSshCommand:
        "ssh -i '/tmp/agent-fleet/keys/owner repo/github-deploy-key' -o IdentitiesOnly=yes -o HostName=ssh.github.com -o Port=443"
    });

    expect(result.status).toBe("prepared");
    const script = runner.commands[0].kind === "ssh" ? runner.commands[0].remoteScript : "";
    expect(script).toContain(
      "env GIT_SSH_COMMAND='ssh -i '\\''/tmp/agent-fleet/keys/owner repo/github-deploy-key'\\'' -o IdentitiesOnly=yes -o HostName=ssh.github.com -o Port=443' git clone --no-checkout"
    );
    expect(script).toContain(
      "env GIT_SSH_COMMAND='ssh -i '\\''/tmp/agent-fleet/keys/owner repo/github-deploy-key'\\'' -o IdentitiesOnly=yes -o HostName=ssh.github.com -o Port=443' git fetch origin"
    );
    expect(script).not.toContain("Host github.com");
    expect(script).not.toContain(".ssh/config");
  });

  it("fetches and checks out the returned result ref", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-git-ref-sync-"));
    const bare = join(dir, "origin.git");
    const workspace = join(dir, "workspace");
    const remoteScratch = join(dir, "remote-scratch");
    const workerName = "agent-fleet-returned-ref-remote-202604262208";

    try {
      await createBareOriginAndClone({ bare, workspace });
      const sync = new GitRefSync(new SpawnGitRefSyncRunner());
      const outbound = await sync.prepareOutbound({ workspacePath: workspace, workerName });

      expect(outbound.status).toBe("prepared");

      await runGit(["clone", bare, remoteScratch]);
      await runGit(["checkout", "-B", outbound.workerBranch, `origin/${outbound.workerBranch}`], remoteScratch);
      await writeFile(join(remoteScratch, "result.txt"), "remote result\n");
      await runGit(["add", "result.txt"], remoteScratch);
      await runGit(["commit", "-m", "remote result"], remoteScratch);
      const returnedSha = (await runGit(["rev-parse", "HEAD"], remoteScratch)).stdout.trim();
      await runGit(["push", "origin", `HEAD:${outbound.returnedRef}`], remoteScratch);

      const inbound = await sync.fetchInbound({
        workspacePath: workspace,
        workerName,
        expectedSha: returnedSha
      });

      expect(inbound.status).toBe("fetched");
      expect(inbound.returnedSha).toBe(returnedSha);
      expect((await runGit(["branch", "--show-current"], workspace)).stdout.trim()).toBe(outbound.returnedBranch);
      expect((await runGit(["rev-parse", "HEAD"], workspace)).stdout.trim()).toBe(returnedSha);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks when pushing the Worker ref fails", async () => {
    const sync = new GitRefSync(new FailingPushRunner());

    const result = await sync.prepareOutbound({
      workspacePath: "/repo",
      workerName: "agent-fleet-push-fails-remote-202604262208"
    });

    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("failed to push Worker ref");
    expect(result.actions).toContain("non-fast-forward");
  });
});

async function createBareOriginAndClone(input: { bare: string; workspace: string }): Promise<void> {
  await runGit(["init", "--bare", input.bare]);
  await runGit(["clone", input.bare, input.workspace]);
  await runGit(["config", "user.email", "test@example.com"], input.workspace);
  await runGit(["config", "user.name", "Test User"], input.workspace);
  await writeFile(join(input.workspace, "README.md"), "test\n");
  await runGit(["add", "README.md"], input.workspace);
  await runGit(["commit", "-m", "initial"], input.workspace);
  await runGit(["push", "origin", "HEAD:main"], input.workspace);
}

function runGit(args: string[], cwd?: string): Promise<GitRefSyncCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
