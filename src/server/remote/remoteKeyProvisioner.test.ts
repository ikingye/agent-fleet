import { describe, expect, it } from "vitest";
import type { GithubDeployKeyLease } from "../../shared/types.js";
import {
  RemoteGithubDeployKeyProvisioner,
  buildGithubDeployKeyGitSshCommand,
  buildGithubDeployKeyPaths,
  type RemoteKeyProvisionCommand,
  type RemoteKeyProvisionCommandResult,
  type RemoteKeyProvisionCommandRunner,
  type RemoteKeyProvisionLocalReader
} from "./remoteKeyProvisioner.js";

class CapturingRemoteKeyRunner implements RemoteKeyProvisionCommandRunner {
  readonly commands: RemoteKeyProvisionCommand[] = [];

  constructor(private readonly result: RemoteKeyProvisionCommandResult = { exitCode: 0, stdout: "", stderr: "" }) {}

  async run(command: RemoteKeyProvisionCommand): Promise<RemoteKeyProvisionCommandResult> {
    this.commands.push(command);
    return this.result;
  }
}

class MemoryLocalReader implements RemoteKeyProvisionLocalReader {
  readonly paths: string[] = [];

  constructor(private readonly files: Readonly<Record<string, string>>) {}

  async readFile(path: string): Promise<string> {
    this.paths.push(path);
    const content = this.files[path];

    if (content === undefined) {
      throw new Error(`missing file: ${path}`);
    }

    return content;
  }
}

describe("buildGithubDeployKeyPaths", () => {
  it("places durable local material under the target workspace and ephemeral remote copies under /tmp/agent-fleet", () => {
    expect(
      buildGithubDeployKeyPaths({
        workspacePath: "/projects/agent-fleet",
        repositorySlug: "owner-agent-fleet"
      })
    ).toEqual({
      localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
      remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key"
    });
  });

  it("rejects repository slugs that are not safe path segments", () => {
    expect(() =>
      buildGithubDeployKeyPaths({
        workspacePath: "/projects/agent-fleet",
        repositorySlug: "../agent-fleet"
      })
    ).toThrow("repositorySlug");

    expect(() =>
      buildGithubDeployKeyPaths({
        workspacePath: "/projects/agent-fleet",
        repositorySlug: ".."
      })
    ).toThrow("repositorySlug");
  });
});

describe("buildGithubDeployKeyGitSshCommand", () => {
  it("quotes the key path and can force GitHub SSH through ssh.github.com:443", () => {
    const command = buildGithubDeployKeyGitSshCommand({
      privateKeyPath: "/tmp/agent-fleet/keys/owner repo/github-deploy-key",
      githubSshHostAlias: true
    });

    expect(command).toBe(
      "ssh -i '/tmp/agent-fleet/keys/owner repo/github-deploy-key' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o HostName=ssh.github.com -o Port=443"
    );
  });

  it("rejects relative key paths", () => {
    expect(() =>
      buildGithubDeployKeyGitSshCommand({
        privateKeyPath: "tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key"
      })
    ).toThrow("privateKeyPath");
  });
});

describe("RemoteGithubDeployKeyProvisioner", () => {
  it("streams local key material to an ephemeral remote key path with private permissions", async () => {
    const keyMaterial = "test-key-material\n";
    const lease = githubDeployKeyLease();
    const runner = new CapturingRemoteKeyRunner();
    const reader = new MemoryLocalReader({
      [lease.localPrivateKeyPath]: keyMaterial
    });
    const provisioner = new RemoteGithubDeployKeyProvisioner({ runner, localReader: reader });

    const result = await provisioner.installRemoteKey({
      lease,
      sshHost: "worker@builder.internal"
    });

    expect(result.status).toBe("installed");
    expect(reader.paths).toEqual([lease.localPrivateKeyPath]);
    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0]).toMatchObject({
      kind: "ssh",
      sshHost: "worker@builder.internal",
      stdin: keyMaterial
    });
    expect(runner.commands[0].remoteScript).toContain("umask 077");
    expect(runner.commands[0].remoteScript).toContain("mkdir -p '/tmp/agent-fleet/keys/owner-agent-fleet'");
    expect(runner.commands[0].remoteScript).toContain("chmod 700 '/tmp/agent-fleet' '/tmp/agent-fleet/keys' '/tmp/agent-fleet/keys/owner-agent-fleet'");
    expect(runner.commands[0].remoteScript).toContain("chmod 600 '/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key'");
    expect(runner.commands[0].remoteScript).not.toContain(keyMaterial.trim());
  });

  it("returns a redacted blocked result when remote installation fails", async () => {
    const lease = githubDeployKeyLease();
    const runner = new CapturingRemoteKeyRunner({ exitCode: 1, stdout: "", stderr: "permission denied\n" });
    const reader = new MemoryLocalReader({
      [lease.localPrivateKeyPath]: "test-key-material\n"
    });
    const provisioner = new RemoteGithubDeployKeyProvisioner({ runner, localReader: reader });

    const result = await provisioner.installRemoteKey({
      lease,
      sshHost: "worker@builder.internal"
    });

    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("failed to install");
    expect(result.actions).toEqual(["permission denied"]);
    expect(result.actions.join("\n")).not.toContain("test-key-material");
  });

  it("returns a blocked result when the local key source is unavailable", async () => {
    const lease = githubDeployKeyLease();
    const runner = new CapturingRemoteKeyRunner();
    const provisioner = new RemoteGithubDeployKeyProvisioner({
      runner,
      localReader: new MemoryLocalReader({})
    });

    const result = await provisioner.installRemoteKey({
      lease,
      sshHost: "worker@builder.internal"
    });

    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("local deploy key");
    expect(result.actions[0]).toContain(lease.localPrivateKeyPath);
    expect(runner.commands).toHaveLength(0);
  });

  it("removes the remote key copy only for pending zero-ref cleanup leases", async () => {
    const lease = githubDeployKeyLease({ status: "released", cleanupStatus: "pending", refcount: 0 });
    const runner = new CapturingRemoteKeyRunner();
    const provisioner = new RemoteGithubDeployKeyProvisioner({ runner, localReader: new MemoryLocalReader({}) });

    const result = await provisioner.cleanupRemoteKey({
      lease,
      sshHost: "worker@builder.internal"
    });

    expect(result.status).toBe("completed");
    expect(result.cleanupStatus).toBe("completed");
    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0]).toMatchObject({
      kind: "ssh",
      sshHost: "worker@builder.internal",
      stdin: ""
    });
    expect(runner.commands[0].remoteScript).toContain("rm -f '/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key'");
    expect(runner.commands[0].remoteScript).toContain("rmdir '/tmp/agent-fleet/keys/owner-agent-fleet'");
  });

  it("skips cleanup for active leases even when called directly", async () => {
    const runner = new CapturingRemoteKeyRunner();
    const provisioner = new RemoteGithubDeployKeyProvisioner({ runner, localReader: new MemoryLocalReader({}) });

    const result = await provisioner.cleanupRemoteKey({
      lease: githubDeployKeyLease({ status: "active", cleanupStatus: "not_requested", refcount: 1 }),
      sshHost: "worker@builder.internal"
    });

    expect(result.status).toBe("skipped");
    expect(runner.commands).toHaveLength(0);
  });
});

function githubDeployKeyLease(overrides: Partial<GithubDeployKeyLease> = {}): GithubDeployKeyLease {
  return {
    id: "lease-1",
    projectName: "agent-fleet",
    workspacePath: "/projects/agent-fleet",
    repositoryUrl: "git@github.com:owner/agent-fleet.git",
    repositorySlug: "owner-agent-fleet",
    githubDeployKeyId: "github-key-1",
    publicKeyFingerprint: "SHA256:test-fingerprint",
    localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
    remoteNodeId: "node-1",
    remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key",
    activeWorkerSessionIds: ["session-1"],
    refcount: 1,
    status: "active",
    cleanupStatus: "not_requested",
    acquiredAt: "2026-04-26T10:00:00.000Z",
    lastHeartbeatAt: "2026-04-26T10:00:00.000Z",
    expiresAt: "2026-04-26T10:15:00.000Z",
    releasedAt: null,
    updatedAt: "2026-04-26T10:00:00.000Z",
    ...overrides
  };
}
