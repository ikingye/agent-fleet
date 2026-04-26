import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonControlPlaneStore } from "./jsonControlPlaneStore.js";

describe("JsonControlPlaneStore", () => {
  it("persists goals, Steward decisions, Worker sessions, worktree assignments, corrections, and memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-store-"));
    const statePath = join(dir, "state.json");

    try {
      const store = await JsonControlPlaneStore.open(statePath);
      const goal = await store.createGoal({
        projectName: "agent-fleet",
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
      const rawState = JSON.parse(await readFile(statePath, "utf8")) as { version: number };

      expect(rawState.version).toBe(1);
      expect(dashboard.goals.map((item) => item.title)).toEqual(["Bootstrap the control plane"]);
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
        sshHost: "worker@mac-mini.local",
        workRoot: "/Users/worker/agent-fleet",
        proxyUrl: null
      });
      const updated = await store.upsertExecutionNode({
        name: "mac-mini-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@mac-mini.local",
        workRoot: "/Users/worker/agent-fleet-updated",
        proxyUrl: "http://127.0.0.1:1080"
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
        sshHost: "worker@mac-mini.local",
        workRoot: "/Users/worker/agent-fleet-updated",
        proxyUrl: "http://127.0.0.1:1080"
      });
      expect(dashboard.events.map((event) => event.type)).toEqual([
        "execution_node.registered",
        "execution_node.updated"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
