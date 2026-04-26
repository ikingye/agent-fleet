import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GithubDeployKeyLease } from "../../shared/types.js";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { maintainGithubDeployKeyLeases } from "./githubDeployKeyLeaseMaintenance.js";

class FakeRemoteGithubDeployKeyProvisioner {
  readonly cleanupInputs: Array<{ lease: GithubDeployKeyLease; sshHost: string }> = [];

  async cleanupRemoteKey(input: { lease: GithubDeployKeyLease; sshHost: string }) {
    this.cleanupInputs.push(input);

    return {
      status: "completed" as const,
      summary: "Remote deploy key cleanup completed.",
      actions: [`Removed ${input.lease.remotePrivateKeyPath}`],
      cleanupStatus: "completed" as const
    };
  }
}

async function withStore<T>(testBody: (store: JsonControlPlaneStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "agent-fleet-lease-maintenance-"));

  try {
    return await testBody(await JsonControlPlaneStore.open(join(dir, "state.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function createRemoteWorker(store: JsonControlPlaneStore, input: { nodeId: string; status?: "running" | "completed" }) {
  const goal = await store.createGoal({
    projectName: "agent-fleet",
    workspacePath: "/projects/agent-fleet",
    title: "Remote deploy-key lease maintenance",
    body: "Keep remote Worker deploy-key leases alive and clean stale key copies."
  });
  const decision = await store.recordDecision({
    goalId: goal.id,
    workerSessionId: null,
    title: "Start remote Worker Agent",
    rationale: "Remote execution needs repository access through a Steward-managed deploy key.",
    risk: "medium",
    confidence: 0.78,
    reversible: true,
    needsHumanReview: false,
    status: "active",
    actions: ["Start a remote Worker Agent session"]
  });
  const session = await store.createWorkerSession({
    goalId: goal.id,
    decisionId: decision.id,
    kind: "codex",
    command: "codexyoloproxy",
    cwd: "/tmp/agent-fleet/work/agent-fleet",
    pid: input.status === "completed" ? null : 4242,
    hostId: input.nodeId,
    resumeId: "resume-lease-maintenance",
    status: input.status ?? "running",
    lastOutput: "Worker started"
  });
  await store.linkDecisionToWorkerSession(decision.id, session.id);

  return session;
}

async function createRemoteNode(store: JsonControlPlaneStore) {
  return store.createExecutionNode({
    name: "lease-builder",
    kind: "remote",
    status: "ready",
    sshHost: "worker@lease-builder.internal",
    workRoot: "/tmp/agent-fleet/work",
    proxyUrl: null
  });
}

async function acquireLease(
  store: JsonControlPlaneStore,
  input: { nodeId: string; workerSessionId: string; expiresAt: string; now: string }
) {
  return store.acquireGithubDeployKeyLease({
    projectName: "agent-fleet",
    workspacePath: "/projects/agent-fleet",
    repositoryUrl: "git@github.com:owner/agent-fleet.git",
    repositorySlug: "owner-agent-fleet",
    githubDeployKeyId: null,
    publicKeyFingerprint: "SHA256:project-key",
    localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
    remoteNodeId: input.nodeId,
    remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key",
    workerSessionId: input.workerSessionId,
    expiresAt: input.expiresAt,
    now: input.now
  });
}

describe("maintainGithubDeployKeyLeases", () => {
  it("renews an active lease held by a running remote Worker session", async () => {
    await withStore(async (store) => {
      const node = await createRemoteNode(store);
      const session = await createRemoteWorker(store, { nodeId: node.id });
      const lease = await acquireLease(store, {
        nodeId: node.id,
        workerSessionId: session.id,
        expiresAt: "2026-04-27T00:05:00.000Z",
        now: "2026-04-27T00:00:00.000Z"
      });

      const result = await maintainGithubDeployKeyLeases({
        store,
        now: "2026-04-27T00:04:00.000Z",
        leaseTtlMs: 10 * 60 * 1000
      });
      const renewedLease = (await store.dashboard()).githubDeployKeyLeases.find((item) => item.id === lease.id);

      expect(result).toMatchObject({
        renewedLeaseIds: [lease.id],
        expiredLeaseIds: [],
        cleanedUpLeaseIds: []
      });
      expect(renewedLease).toMatchObject({
        status: "active",
        refcount: 1,
        lastHeartbeatAt: "2026-04-27T00:04:00.000Z",
        expiresAt: "2026-04-27T00:14:00.000Z"
      });
    });
  });

  it("expires a stale lease when no active remote Worker session still holds it", async () => {
    await withStore(async (store) => {
      const node = await createRemoteNode(store);
      const session = await createRemoteWorker(store, { nodeId: node.id, status: "completed" });
      const lease = await acquireLease(store, {
        nodeId: node.id,
        workerSessionId: session.id,
        expiresAt: "2026-04-27T00:05:00.000Z",
        now: "2026-04-27T00:00:00.000Z"
      });

      const result = await maintainGithubDeployKeyLeases({
        store,
        now: "2026-04-27T00:06:00.000Z",
        leaseTtlMs: 10 * 60 * 1000
      });
      const expiredLease = (await store.dashboard()).githubDeployKeyLeases.find((item) => item.id === lease.id);

      expect(result.expiredLeaseIds).toEqual([lease.id]);
      expect(expiredLease).toMatchObject({
        activeWorkerSessionIds: [],
        refcount: 0,
        status: "stale",
        cleanupStatus: "pending",
        releasedAt: "2026-04-27T00:06:00.000Z"
      });
    });
  });

  it("cleans up pending zero-ref leases through the remote key provisioner", async () => {
    await withStore(async (store) => {
      const node = await createRemoteNode(store);
      const session = await createRemoteWorker(store, { nodeId: node.id });
      const lease = await acquireLease(store, {
        nodeId: node.id,
        workerSessionId: session.id,
        expiresAt: "2026-04-27T00:05:00.000Z",
        now: "2026-04-27T00:00:00.000Z"
      });
      await store.releaseGithubDeployKeyLease({
        leaseId: lease.id,
        workerSessionId: session.id,
        now: "2026-04-27T00:01:00.000Z"
      });
      const provisioner = new FakeRemoteGithubDeployKeyProvisioner();

      const result = await maintainGithubDeployKeyLeases({
        store,
        now: "2026-04-27T00:02:00.000Z",
        leaseTtlMs: 10 * 60 * 1000,
        remoteGithubDeployKeyProvisioner: provisioner
      });
      const cleanedLease = (await store.dashboard()).githubDeployKeyLeases.find((item) => item.id === lease.id);

      expect(result.cleanedUpLeaseIds).toEqual([lease.id]);
      expect(provisioner.cleanupInputs).toEqual([
        {
          lease: expect.objectContaining({
            id: lease.id,
            remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key"
          }),
          sshHost: "worker@lease-builder.internal"
        }
      ]);
      expect(cleanedLease).toMatchObject({ cleanupStatus: "completed" });
    });
  });

  it("does not clean a pending key path while another active remote Worker lease still uses it", async () => {
    await withStore(async (store) => {
      const node = await createRemoteNode(store);
      const staleSession = await createRemoteWorker(store, { nodeId: node.id, status: "completed" });
      const staleLease = await acquireLease(store, {
        nodeId: node.id,
        workerSessionId: staleSession.id,
        expiresAt: "2026-04-27T00:05:00.000Z",
        now: "2026-04-27T00:00:00.000Z"
      });
      await store.expireGithubDeployKeyLeases({ now: "2026-04-27T00:06:00.000Z" });
      const activeSession = await createRemoteWorker(store, { nodeId: node.id });
      await acquireLease(store, {
        nodeId: node.id,
        workerSessionId: activeSession.id,
        expiresAt: "2026-04-27T00:20:00.000Z",
        now: "2026-04-27T00:10:00.000Z"
      });
      const provisioner = new FakeRemoteGithubDeployKeyProvisioner();

      const result = await maintainGithubDeployKeyLeases({
        store,
        now: "2026-04-27T00:12:00.000Z",
        leaseTtlMs: 10 * 60 * 1000,
        remoteGithubDeployKeyProvisioner: provisioner
      });
      const pendingLease = (await store.dashboard()).githubDeployKeyLeases.find((item) => item.id === staleLease.id);

      expect(result.cleanedUpLeaseIds).toEqual([]);
      expect(result.skippedCleanupLeaseIds).toEqual([staleLease.id]);
      expect(provisioner.cleanupInputs).toEqual([]);
      expect(pendingLease).toMatchObject({ cleanupStatus: "pending" });
    });
  });

  it("does not repeat cleanup after a pending lease has already completed cleanup", async () => {
    await withStore(async (store) => {
      const node = await createRemoteNode(store);
      const session = await createRemoteWorker(store, { nodeId: node.id });
      const lease = await acquireLease(store, {
        nodeId: node.id,
        workerSessionId: session.id,
        expiresAt: "2026-04-27T00:05:00.000Z",
        now: "2026-04-27T00:00:00.000Z"
      });
      await store.releaseGithubDeployKeyLease({
        leaseId: lease.id,
        workerSessionId: session.id,
        now: "2026-04-27T00:01:00.000Z"
      });
      const provisioner = new FakeRemoteGithubDeployKeyProvisioner();

      await maintainGithubDeployKeyLeases({
        store,
        now: "2026-04-27T00:02:00.000Z",
        leaseTtlMs: 10 * 60 * 1000,
        remoteGithubDeployKeyProvisioner: provisioner
      });
      const secondResult = await maintainGithubDeployKeyLeases({
        store,
        now: "2026-04-27T00:03:00.000Z",
        leaseTtlMs: 10 * 60 * 1000,
        remoteGithubDeployKeyProvisioner: provisioner
      });

      expect(provisioner.cleanupInputs).toHaveLength(1);
      expect(secondResult.cleanedUpLeaseIds).toEqual([]);
    });
  });
});
