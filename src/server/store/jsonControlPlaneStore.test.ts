import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonControlPlaneStore } from "./jsonControlPlaneStore.js";

describe("JsonControlPlaneStore", () => {
  it("persists goals, Steward decisions, Worker sessions, reports, worktree assignments, corrections, and memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const goal = await store.createGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap the control plane",
        body: "Build a Steward Agent that can coordinate Worker Agents overnight."
      });
      const decision = await store.recordDecision({
        goalId: goal.id,
        workerSessionId: null,
        title: "Dispatch Codex Worker",
        rationale: "The goal is executable and low-risk enough for autonomous first pass.",
        risk: "medium",
        confidence: 0.74,
        reversible: true,
        needsHumanReview: true,
        status: "active",
        actions: ["Create a Worker session", "Record resume metadata"]
      });
      const worker = await store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/worktrees/bootstrap",
        pid: 4242,
        hostId: null,
        resumeId: "resume-123",
        status: "running"
      });
      const workerReport = await store.recordWorkerReport({
        goalId: goal.id,
        workerSessionId: worker.id,
        status: "DONE_WITH_CONCERNS",
        changedFiles: ["src/server/workers/workerReportParser.ts"],
        verification: ["npm run check"],
        decisions: ["Persist parsed Worker reports in dashboard state."],
        blockers: ["Owner needs to decide whether to merge."],
        nextActions: ["Review report and merge if acceptable."],
        needsOwnerReview: true,
        resumeId: "resume-worker-report",
        markdown: "Status: DONE_WITH_CONCERNS"
      });
      const assignment = await store.createWorktreeAssignment({
        workerSessionId: worker.id,
        repositoryPath: "/repo/agent-fleet",
        worktreePath: "/repo/agent-fleet/.worktrees/worker-123-bootstrap-control-plane",
        branchName: "agent-fleet/worker-123-bootstrap-control-plane"
      });
      await store.addCorrection({
        decisionId: decision.id,
        body: "Prefer Steward Agent and Worker Agent naming.",
        createdBy: "human"
      });
      await store.upsertMemory({
        scope: "user",
        projectName: null,
        key: "agent_vocabulary",
        value: "Use Steward Agent and Worker Agent.",
        sourceCorrectionId: decision.id
      });

      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();
      const workerReports = dashboard.workerReports ?? [];
      const rawState = JSON.parse(await readFile(statePath, "utf8")) as { version: number };

      expect(rawState.version).toBe(1);
      expect(dashboard.goals).toEqual([
        expect.objectContaining({
          title: "Bootstrap the control plane",
          workspacePath: "/projects/agent-fleet"
        })
      ]);
      expect(dashboard.decisions[0]).toMatchObject({
        id: decision.id,
        workerSessionId: null,
        title: "Dispatch Codex Worker",
        risk: "medium",
        needsHumanReview: true
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        id: worker.id,
        command: "codexyoloproxy",
        resumeId: "resume-123",
        status: "running"
      });
      expect(workerReports[0]).toMatchObject({
        id: workerReport.id,
        goalId: goal.id,
        workerSessionId: worker.id,
        status: "DONE_WITH_CONCERNS",
        changedFiles: ["src/server/workers/workerReportParser.ts"],
        verification: ["npm run check"],
        decisions: ["Persist parsed Worker reports in dashboard state."],
        blockers: ["Owner needs to decide whether to merge."],
        nextActions: ["Review report and merge if acceptable."],
        needsOwnerReview: true,
        resumeId: "resume-worker-report",
        markdown: "Status: DONE_WITH_CONCERNS"
      });
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        id: assignment.id,
        workerSessionId: worker.id,
        repositoryPath: "/repo/agent-fleet",
        worktreePath: "/repo/agent-fleet/.worktrees/worker-123-bootstrap-control-plane",
        branchName: "agent-fleet/worker-123-bootstrap-control-plane",
        status: "planned"
      });
      expect(dashboard.corrections[0]).toMatchObject({
        decisionId: decision.id,
        body: "Prefer Steward Agent and Worker Agent naming."
      });
      expect(dashboard.memories[0]).toMatchObject({
        key: "agent_vocabulary",
        value: "Use Steward Agent and Worker Agent."
      });
      expect(dashboard.events.map((event) => event.type)).toContain("worker.report.recorded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists Steward messages and exposes them on the dashboard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const ownerMessage = await store.recordStewardMessage({
        role: "owner",
        projectName: "mahjong",
        workspacePath: "/workspaces/mahjong",
        goalId: null,
        body: "What is running for mahjong?"
      });
      const stewardMessage = await store.recordStewardMessage({
        role: "steward",
        projectName: "mahjong",
        workspacePath: "/workspaces/mahjong",
        goalId: null,
        body: "I do not see active goals for mahjong yet."
      });

      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();

      expect(dashboard.stewardMessages).toEqual([
        expect.objectContaining({
          id: ownerMessage.id,
          role: "owner",
          projectName: "mahjong",
          workspacePath: "/workspaces/mahjong",
          goalId: null,
          body: "What is running for mahjong?"
        }),
        expect.objectContaining({
          id: stewardMessage.id,
          role: "steward",
          projectName: "mahjong",
          workspacePath: "/workspaces/mahjong",
          goalId: null,
          body: "I do not see active goals for mahjong yet."
        })
      ]);
      expect(await reopened.listStewardMessages({ workspacePath: "/workspaces/mahjong" })).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses legacy goals without workspacePath using a deterministic fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            goals: [
              {
                id: "legacy-goal",
                projectName: "Mahjong App",
                title: "Legacy goal",
                body: "This record predates workspacePath.",
                status: "queued",
                createdAt: "2026-04-26T00:00:00.000Z",
                updatedAt: "2026-04-26T00:00:00.000Z"
              }
            ]
          },
          null,
          2
        )
      );

      const store = await JsonControlPlaneStore.open(statePath);
      const dashboard = await store.dashboard();

      expect(dashboard.goals[0]).toMatchObject({
        id: "legacy-goal",
        workspacePath: "/legacy-agent-fleet-workspaces/mahjong-app"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upserts execution nodes by name and records audit events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const created = await store.upsertExecutionNode({
        name: "mac-mini-builder",
        kind: "remote",
        status: "unknown",
        sshHost: "worker@remote-worker.example",
        workRoot: "/tmp/agent-fleet/work",
        proxyUrl: null,
        tags: ["remote", "linux"],
        capacity: 1
      });
      const updated = await store.upsertExecutionNode({
        name: "mac-mini-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@remote-worker.example",
        workRoot: "/tmp/agent-fleet/work-updated",
        proxyUrl: "http://127.0.0.1:1080",
        tags: ["remote", "linux", "high-cpu"],
        capacity: 4
      });

      const dashboard = await store.dashboard();

      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(dashboard.executionNodes).toHaveLength(1);
      expect(dashboard.executionNodes[0]).toMatchObject({
        id: created.id,
        name: "mac-mini-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@remote-worker.example",
        workRoot: "/tmp/agent-fleet/work-updated",
        proxyUrl: "http://127.0.0.1:1080",
        tags: ["remote", "linux", "high-cpu"],
        capacity: 4
      });
      expect(dashboard.events.map((event) => event.type)).toEqual([
        "execution_node.registered",
        "execution_node.updated"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses legacy execution nodes without tags or capacity using defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            executionNodes: [
              {
                id: "legacy-node",
                name: "legacy-remote",
                kind: "remote",
                status: "ready",
                sshHost: "worker@legacy.example",
                workRoot: "/srv/legacy",
                proxyUrl: null,
                createdAt: "2026-04-26T00:00:00.000Z",
                updatedAt: "2026-04-26T00:00:00.000Z"
              }
            ]
          },
          null,
          2
        )
      );

      const store = await JsonControlPlaneStore.open(statePath);
      const dashboard = await store.dashboard();

      expect(dashboard.executionNodes[0]).toMatchObject({
        id: "legacy-node",
        name: "legacy-remote",
        tags: [],
        capacity: 1
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("updates Worker session status and output with an audit event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const goal = await store.createGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Supervise Worker sessions",
        body: "Keep Worker lifecycle status durable after restart."
      });
      const decision = await store.recordDecision({
        goalId: goal.id,
        workerSessionId: null,
        title: "Start lifecycle supervision",
        rationale: "The Steward Agent needs durable Worker session updates.",
        risk: "medium",
        confidence: 0.8,
        reversible: true,
        needsHumanReview: true,
        status: "active",
        actions: ["Record status transitions", "Persist last output"]
      });
      const worker = await store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/worktrees/supervisor",
        pid: 5151,
        hostId: "local",
        resumeId: "resume-supervisor",
        status: "running",
        lastOutput: "Worker started"
      });

      const updated = await store.updateWorkerSessionStatus({
        workerSessionId: worker.id,
        status: "completed",
        lastOutput: "npm run check passed"
      });
      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();
      const event = dashboard.events.at(-1);

      expect(updated).toMatchObject({
        id: worker.id,
        status: "completed",
        lastOutput: "npm run check passed"
      });
      expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(worker.updatedAt));
      expect(dashboard.workerSessions[0]).toMatchObject({
        id: worker.id,
        status: "completed",
        lastOutput: "npm run check passed"
      });
      expect(event).toMatchObject({
        type: "worker.status.updated",
        goalId: goal.id,
        decisionId: decision.id,
        workerSessionId: worker.id,
        message: "Worker session status changed from running to completed"
      });
      expect(JSON.parse(event?.metadataJson ?? "{}")).toEqual({
        previousStatus: "running",
        status: "completed",
        lastOutput: "npm run check passed"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists Steward checkpoints with an audit event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const goal = await store.createGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Recover Steward context",
        body: "Make the Steward Agent restartable after compact failures."
      });
      const decision = await store.recordDecision({
        goalId: goal.id,
        workerSessionId: null,
        title: "Dispatch recovery Worker",
        rationale: "A Worker Agent can implement durable recovery while the Steward coordinates.",
        risk: "medium",
        confidence: 0.82,
        reversible: true,
        needsHumanReview: true,
        status: "active",
        actions: ["Create durable checkpoint", "Expose recovery report"]
      });
      const worker = await store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/worktrees/recovery",
        pid: 6262,
        hostId: "local",
        resumeId: "resume-recovery",
        status: "running"
      });

      const checkpoint = await store.recordStewardCheckpoint({
        reason: "crash",
        summary: "Main Steward session lost compact stream before completion.",
        nextAction: "Open the recovery report and resume the running Worker Agent.",
        goalIds: [goal.id],
        workerSessionIds: [worker.id]
      });

      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();
      const event = dashboard.events.at(-1);

      expect(dashboard.stewardCheckpoints[0]).toMatchObject({
        id: checkpoint.id,
        reason: "crash",
        summary: "Main Steward session lost compact stream before completion.",
        nextAction: "Open the recovery report and resume the running Worker Agent.",
        goalIds: [goal.id],
        workerSessionIds: [worker.id]
      });
      expect(event).toMatchObject({
        type: "steward.checkpoint.recorded",
        goalId: goal.id,
        decisionId: null,
        workerSessionId: worker.id,
        message: "Main Steward session lost compact stream before completion."
      });
      expect(JSON.parse(event?.metadataJson ?? "{}")).toEqual({
        checkpointId: checkpoint.id,
        reason: "crash",
        goalIds: [goal.id],
        workerSessionIds: [worker.id],
        nextAction: "Open the recovery report and resume the running Worker Agent."
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("acquires, renews, releases, and expires shared GitHub deploy-key leases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const node = await store.upsertExecutionNode({
        name: "remote-build-1",
        kind: "remote",
        status: "ready",
        sshHost: "worker@remote-build-1.example",
        workRoot: "/tmp/agent-fleet/work",
        proxyUrl: null,
        tags: ["remote", "linux"],
        capacity: 2
      });
      const goal = await store.createGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Run remote Workers",
        body: "Use a Steward-managed project deploy key for remote GitHub access."
      });
      const decision = await store.recordDecision({
        goalId: goal.id,
        workerSessionId: null,
        title: "Lease project deploy key",
        rationale: "Workers share one repo-scoped deploy key through the Steward registry.",
        risk: "high",
        confidence: 0.78,
        reversible: true,
        needsHumanReview: true,
        status: "active",
        actions: ["Acquire deploy-key lease before remote dispatch"]
      });
      const workerOne = await store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/tmp/agent-fleet/work/agent-fleet/agent-fleet",
        pid: 1111,
        hostId: node.id,
        resumeId: "resume-one",
        status: "running"
      });
      const workerTwo = await store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/tmp/agent-fleet/work/agent-fleet/agent-fleet-2",
        pid: 2222,
        hostId: node.id,
        resumeId: "resume-two",
        status: "running"
      });

      const firstLease = await store.acquireGithubDeployKeyLease({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        repositoryUrl: "git@github.com:owner/agent-fleet.git",
        repositorySlug: "owner-agent-fleet",
        githubDeployKeyId: "github-key-123",
        publicKeyFingerprint: "SHA256:project-key",
        localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
        remoteNodeId: node.id,
        remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key",
        workerSessionId: workerOne.id,
        expiresAt: "2026-04-26T10:10:00.000Z",
        now: "2026-04-26T10:00:00.000Z"
      });
      const sharedLease = await store.acquireGithubDeployKeyLease({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        repositoryUrl: "git@github.com:owner/agent-fleet.git",
        repositorySlug: "owner-agent-fleet",
        githubDeployKeyId: "github-key-123",
        publicKeyFingerprint: "SHA256:project-key",
        localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
        remoteNodeId: node.id,
        remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key",
        workerSessionId: workerTwo.id,
        expiresAt: "2026-04-26T10:15:00.000Z",
        now: "2026-04-26T10:05:00.000Z"
      });

      expect(sharedLease.id).toBe(firstLease.id);
      expect(sharedLease).toMatchObject({
        activeWorkerSessionIds: [workerOne.id, workerTwo.id],
        refcount: 2,
        status: "active",
        cleanupStatus: "not_requested",
        expiresAt: "2026-04-26T10:15:00.000Z",
        lastHeartbeatAt: "2026-04-26T10:05:00.000Z"
      });

      const renewedLease = await store.renewGithubDeployKeyLease({
        leaseId: sharedLease.id,
        workerSessionId: workerOne.id,
        expiresAt: "2026-04-26T10:30:00.000Z",
        now: "2026-04-26T10:20:00.000Z"
      });

      expect(renewedLease).toMatchObject({
        activeWorkerSessionIds: [workerOne.id, workerTwo.id],
        refcount: 2,
        expiresAt: "2026-04-26T10:30:00.000Z",
        lastHeartbeatAt: "2026-04-26T10:20:00.000Z"
      });

      const stillShared = await store.releaseGithubDeployKeyLease({
        leaseId: renewedLease.id,
        workerSessionId: workerOne.id,
        now: "2026-04-26T10:21:00.000Z"
      });

      expect(stillShared).toMatchObject({
        activeWorkerSessionIds: [workerTwo.id],
        refcount: 1,
        status: "active",
        cleanupStatus: "not_requested"
      });

      const released = await store.releaseGithubDeployKeyLease({
        leaseId: renewedLease.id,
        workerSessionId: workerTwo.id,
        now: "2026-04-26T10:22:00.000Z"
      });

      expect(released).toMatchObject({
        activeWorkerSessionIds: [],
        refcount: 0,
        status: "released",
        cleanupStatus: "pending"
      });

      const staleLease = await store.acquireGithubDeployKeyLease({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        repositoryUrl: "git@github.com:owner/agent-fleet.git",
        repositorySlug: "owner-agent-fleet",
        githubDeployKeyId: "github-key-123",
        publicKeyFingerprint: "SHA256:project-key",
        localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
        remoteNodeId: node.id,
        remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key",
        workerSessionId: workerOne.id,
        expiresAt: "2026-04-26T11:00:00.000Z",
        now: "2026-04-26T10:50:00.000Z"
      });
      const cleanup = await store.expireGithubDeployKeyLeases({
        now: "2026-04-26T11:01:00.000Z"
      });
      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();

      expect(staleLease.id).not.toBe(released.id);
      expect(cleanup.expiredLeaseIds).toEqual([staleLease.id]);
      expect(dashboard.githubDeployKeyLeases).toEqual([
        expect.objectContaining({
          id: released.id,
          refcount: 0,
          status: "released",
          cleanupStatus: "pending"
        }),
        expect.objectContaining({
          id: staleLease.id,
          activeWorkerSessionIds: [],
          refcount: 0,
          status: "stale",
          cleanupStatus: "pending"
        })
      ]);
      expect(dashboard.events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "github_deploy_key_lease.acquired",
          "github_deploy_key_lease.renewed",
          "github_deploy_key_lease.released",
          "github_deploy_key_lease.expired"
        ])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates legacy state without conversation collections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            stewardMessages: [
              {
                id: "legacy-message",
                role: "owner",
                projectName: "agent-fleet",
                workspacePath: "/projects/agent-fleet",
                goalId: null,
                body: "Legacy Steward chat message.",
                createdAt: "2026-04-26T00:00:00.000Z"
              }
            ]
          },
          null,
          2
        )
      );

      const store = await JsonControlPlaneStore.open(statePath);
      const dashboard = await store.dashboard();

      expect(dashboard.conversations).toEqual([]);
      expect(dashboard.conversationBindings).toEqual([]);
      expect(dashboard.messageDeliveries).toEqual([]);
      expect(dashboard.stewardMessages?.[0]).toMatchObject({
        id: "legacy-message",
        conversationId: null,
        transport: null,
        externalMessageId: null,
        idempotencyKey: null,
        senderDisplay: null,
        deliveryStatus: null
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates, lists, and persists conversations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const conversation = await store.upsertConversation({
        transport: "cli",
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        externalConversationId: "cli-session-1",
        title: "CLI intake"
      });

      expect(await store.listConversations({ workspacePath: "/projects/agent-fleet" })).toEqual([
        expect.objectContaining({
          id: conversation.id,
          transport: "cli",
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          externalConversationId: "cli-session-1",
          title: "CLI intake"
        })
      ]);

      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();

      expect(dashboard.conversations).toEqual([
        expect.objectContaining({
          id: conversation.id,
          transport: "cli",
          workspacePath: "/projects/agent-fleet",
          externalConversationId: "cli-session-1"
        })
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("associates Steward messages with conversation and workspace filters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const conversation = await store.upsertConversation({
        transport: "web",
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        externalConversationId: "browser-thread-1",
        title: "Dashboard chat"
      });
      const message = await store.recordStewardMessage({
        role: "owner",
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        goalId: null,
        body: "Please show current Worker status.",
        conversationId: conversation.id,
        transport: "web",
        externalMessageId: "web-message-1",
        idempotencyKey: "web-idempotency-1",
        senderDisplay: "Owner",
        deliveryStatus: "delivered"
      });

      expect(
        await store.listStewardMessages({
          conversationId: conversation.id,
          workspacePath: "/projects/agent-fleet"
        })
      ).toEqual([
        expect.objectContaining({
          id: message.id,
          conversationId: conversation.id,
          transport: "web",
          externalMessageId: "web-message-1",
          idempotencyKey: "web-idempotency-1",
          senderDisplay: "Owner",
          deliveryStatus: "delivered"
        })
      ]);

      const reopened = await JsonControlPlaneStore.open(statePath);
      const dashboard = await reopened.dashboard();

      expect(dashboard.stewardMessages?.[0]).toMatchObject({
        id: message.id,
        conversationId: conversation.id,
        workspacePath: "/projects/agent-fleet"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects duplicate inbound message deliveries deterministically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const conversation = await store.upsertConversation({
        transport: "im",
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        externalConversationId: "slack-thread-1",
        title: "Slack intake"
      });
      const message = await store.recordStewardMessage({
        role: "owner",
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        goalId: null,
        body: "Run a status check.",
        conversationId: conversation.id,
        transport: "im",
        externalMessageId: "slack-message-1",
        idempotencyKey: "slack-idempotency-1",
        senderDisplay: "Owner via Slack",
        deliveryStatus: "delivered"
      });
      const firstDelivery = await store.recordMessageDelivery({
        conversationId: conversation.id,
        stewardMessageId: message.id,
        transport: "im",
        direction: "inbound",
        externalMessageId: "slack-message-1",
        idempotencyKey: "slack-idempotency-1",
        deliveryStatus: "delivered"
      });
      const duplicateByIdempotencyKey = await store.recordMessageDelivery({
        conversationId: conversation.id,
        stewardMessageId: null,
        transport: "im",
        direction: "inbound",
        externalMessageId: "slack-message-2",
        idempotencyKey: "slack-idempotency-1",
        deliveryStatus: "delivered"
      });
      const duplicateByExternalMessageId = await store.recordMessageDelivery({
        conversationId: conversation.id,
        stewardMessageId: null,
        transport: "im",
        direction: "inbound",
        externalMessageId: "slack-message-1",
        idempotencyKey: "slack-idempotency-2",
        deliveryStatus: "delivered"
      });
      const dashboard = await store.dashboard();

      expect(firstDelivery).toMatchObject({
        duplicate: false,
        duplicateOf: null,
        delivery: expect.objectContaining({
          conversationId: conversation.id,
          stewardMessageId: message.id,
          externalMessageId: "slack-message-1",
          idempotencyKey: "slack-idempotency-1"
        })
      });
      expect(duplicateByIdempotencyKey).toMatchObject({
        duplicate: true,
        duplicateOf: firstDelivery.delivery.id,
        delivery: expect.objectContaining({ id: firstDelivery.delivery.id })
      });
      expect(duplicateByExternalMessageId).toMatchObject({
        duplicate: true,
        duplicateOf: firstDelivery.delivery.id,
        delivery: expect.objectContaining({ id: firstDelivery.delivery.id })
      });
      expect(dashboard.messageDeliveries).toEqual([
        expect.objectContaining({
          id: firstDelivery.delivery.id,
          conversationId: conversation.id,
          stewardMessageId: message.id
        })
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

});
