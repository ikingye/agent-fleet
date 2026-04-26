import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ExecutionNode } from "../../shared/types.js";
import { GitRefSync, type GitRefSyncCommand, type GitRefSyncCommandResult, type GitRefSyncCommandRunner } from "./gitRefSync.js";
import { GitRemoteWorkspaceProvisioner } from "./remoteWorkspaceProvisioner.js";

class CapturingProvisionRunner implements GitRefSyncCommandRunner {
  readonly sshInputs: Array<{ sshHost: string; remoteScript: string }> = [];

  constructor(private readonly exitCode = 0) {}

  async run(command: GitRefSyncCommand): Promise<GitRefSyncCommandResult> {
    if (command.kind === "ssh") {
      this.sshInputs.push({
        sshHost: command.sshHost,
        remoteScript: command.remoteScript
      });
      return { exitCode: this.exitCode, stdout: "", stderr: "" };
    }

    return runGit(command.args, command.cwd);
  }
}

describe("GitRemoteWorkspaceProvisioner", () => {
  it("ensures the remote cwd and prepares a git checkout when the local workspace has an origin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provision-"));
    const workspace = join(dir, "workspace");
    const origin = join(dir, "origin.git");
    const runner = new CapturingProvisionRunner();

    try {
      await run("git", ["init", "--bare", origin]);
      await createGitWorkspace(workspace, origin);
      const provisioner = new GitRemoteWorkspaceProvisioner(new GitRefSync(runner));

      const result = await provisioner.provision({
        node: remoteNode(),
        localWorkspacePath: workspace,
        remoteWorkspacePath: "/srv/agent-fleet/agent-fleet/repo",
        workerName: "agent-fleet-run-build-remote-202604262208"
      });

      expect(result.status).toBe("prepared");
      expect(result.summary).toContain("refs/heads/agent-fleet/workers/agent-fleet-run-build-remote-202604262208");
      expect(runner.sshInputs).toHaveLength(1);
      expect(runner.sshInputs[0].sshHost).toBe("worker@builder.internal");
      expect(runner.sshInputs[0].remoteScript).toContain(`git clone --no-checkout '${origin}'`);
      expect(runner.sshInputs[0].remoteScript).toContain(
        "git fetch origin '+refs/heads/agent-fleet/workers/agent-fleet-run-build-remote-202604262208:refs/remotes/origin/agent-fleet/workers/agent-fleet-run-build-remote-202604262208'"
      );
      expect(runner.sshInputs[0].remoteScript).toContain(
        "git checkout -B 'agent-fleet/workers/agent-fleet-run-build-remote-202604262208' FETCH_HEAD"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks after ensuring the remote cwd when the local git workspace has no origin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provision-"));
    const workspace = join(dir, "workspace");
    const runner = new CapturingProvisionRunner();

    try {
      await createGitWorkspace(workspace, null);
      const provisioner = new GitRemoteWorkspaceProvisioner(new GitRefSync(runner));

      const result = await provisioner.provision({
        node: remoteNode(),
        localWorkspacePath: workspace,
        remoteWorkspacePath: "/srv/agent-fleet/agent-fleet/repo",
        workerName: "agent-fleet-run-build-remote-202604262208"
      });

      expect(result.status).toBe("blocked");
      expect(result.summary).toContain("has no remote origin URL");
      expect(runner.sshInputs).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function createGitWorkspace(path: string, originUrl: string | null): Promise<void> {
  await run("git", ["init", "-b", "main", path]);
  await run("git", ["config", "user.email", "test@example.com"], path);
  await run("git", ["config", "user.name", "Test User"], path);
  await writeFile(join(path, "README.md"), "test\n");
  await run("git", ["add", "README.md"], path);
  await run("git", ["commit", "-m", "initial"], path);

  if (originUrl !== null) {
    await run("git", ["remote", "add", "origin", originUrl], path);
  }
}

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
    });
  });
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

function remoteNode(): ExecutionNode {
  return {
    id: "node-1",
    name: "builder",
    kind: "remote",
    status: "ready",
    sshHost: "worker@builder.internal",
    workRoot: "/srv/agent-fleet",
    proxyUrl: null,
    tags: ["remote"],
    capacity: 1,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  };
}
