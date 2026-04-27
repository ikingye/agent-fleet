import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { LocalGithubDeployKeyLeaseResolver, openSshPublicKeyFingerprint } from "./githubDeployKeyLeaseResolver.js";
import type { ExecutionNode } from "../../shared/types.js";

describe("openSshPublicKeyFingerprint", () => {
  it("computes an OpenSSH SHA256 fingerprint from public key material", () => {
    expect(openSshPublicKeyFingerprint("ssh-ed25519 YWJj fake@example.com")).toBe(
      "SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0"
    );
  });
});

describe("LocalGithubDeployKeyLeaseResolver", () => {
  it("resolves local ignored deploy-key config for a GitHub origin without calling GitHub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-key-config-"));

    try {
      spawnSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      spawnSync("git", ["remote", "add", "origin", "git@github.com:Owner/agent-fleet.git"], {
        cwd: dir,
        stdio: "ignore"
      });
      const keyDir = join(dir, ".agent-fleet", "secrets", "owner-agent-fleet");
      await mkdir(keyDir, { recursive: true });
      await writeFile(join(keyDir, "github-deploy-key"), "fake private key");
      await writeFile(join(keyDir, "github-deploy-key.pub"), "ssh-ed25519 YWJj fake@example.com");

      const resolver = new LocalGithubDeployKeyLeaseResolver();
      const result = await resolver.resolve({
        projectName: "agent-fleet",
        workspacePath: dir,
        node: executionNode()
      });

      expect(result).toEqual({
        repositoryUrl: "git@github.com:Owner/agent-fleet.git",
        repositorySlug: "owner-agent-fleet",
        githubDeployKeyId: null,
        publicKeyFingerprint: "SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0",
        localPrivateKeyPath: join(dir, ".agent-fleet", "secrets", "owner-agent-fleet", "github-deploy-key"),
        remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips when the local deploy-key files are absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-key-config-"));

    try {
      spawnSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      spawnSync("git", ["remote", "add", "origin", "https://github.com/owner/agent-fleet.git"], {
        cwd: dir,
        stdio: "ignore"
      });

      const resolver = new LocalGithubDeployKeyLeaseResolver();

      await expect(
        resolver.resolve({
          projectName: "agent-fleet",
          workspacePath: dir,
          node: executionNode()
        })
      ).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function executionNode(): ExecutionNode {
  return {
    id: "remote-node-1",
    name: "linux-builder",
    kind: "remote",
    status: "ready",
    sshHost: "worker@linux-builder.example",
    workRoot: "/srv/agent-fleet",
    proxyUrl: null,
    tags: ["remote", "linux"],
    capacity: 1,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  };
}
