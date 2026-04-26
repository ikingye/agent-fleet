import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ExecutionNode } from "../../shared/types.js";
import { GitRemoteWorkspaceProvisioner, type RemoteWorkspaceProvisionRunner } from "./remoteWorkspaceProvisioner.js";

class CapturingProvisionRunner implements RemoteWorkspaceProvisionRunner {
  readonly inputs: Array<{ sshHost: string; remoteScript: string }> = [];

  constructor(private readonly exitCode = 0) {}

  async run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.inputs.push(input);
    return { exitCode: this.exitCode, stdout: "", stderr: "" };
  }
}

describe("GitRemoteWorkspaceProvisioner", () => {
  it("ensures the remote cwd and prepares a git checkout when the local workspace has an origin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provision-"));
    const workspace = join(dir, "workspace");
    const runner = new CapturingProvisionRunner();

    try {
      await createGitWorkspace(workspace, "git@example.com:owner/repo.git");
      const provisioner = new GitRemoteWorkspaceProvisioner(runner);

      const result = await provisioner.provision({
        node: remoteNode(),
        localWorkspacePath: workspace,
        remoteWorkspacePath: "/srv/agent-fleet/agent-fleet/repo"
      });

      expect(result.status).toBe("prepared");
      expect(result.summary).toContain("git@example.com:owner/repo.git");
      expect(runner.inputs).toHaveLength(2);
      expect(runner.inputs[0]).toEqual({
        sshHost: "worker@builder.internal",
        remoteScript: "mkdir -p '/srv/agent-fleet/agent-fleet/repo'"
      });
      expect(runner.inputs[1].remoteScript).toContain("git clone 'git@example.com:owner/repo.git'");
      expect(runner.inputs[1].remoteScript).toContain("git fetch --prune origin");
      expect(runner.inputs[1].remoteScript).toContain("git checkout 'main'");
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
      const provisioner = new GitRemoteWorkspaceProvisioner(runner);

      const result = await provisioner.provision({
        node: remoteNode(),
        localWorkspacePath: workspace,
        remoteWorkspacePath: "/srv/agent-fleet/agent-fleet/repo"
      });

      expect(result.status).toBe("blocked");
      expect(result.summary).toContain("has no remote origin URL");
      expect(runner.inputs).toHaveLength(1);
      expect(runner.inputs[0].remoteScript).toBe("mkdir -p '/srv/agent-fleet/agent-fleet/repo'");
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
