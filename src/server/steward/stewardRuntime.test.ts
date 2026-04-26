import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import type { MaterializeWorktreeRunner } from "../worktrees/worktreeManager.js";
import { StewardRuntime } from "./stewardRuntime.js";
import type { WorkerAdapter } from "../workers/commandWorkerAdapter.js";

class FakeWorkerAdapter implements WorkerAdapter {
  readonly kind = "codex";
  readonly startInputs: Array<{ goalTitle: string; prompt: string; cwd: string }> = [];

  async start(input: { goalTitle: string; prompt: string; cwd: string }) {
    this.startInputs.push(input);

    return {
      command: "codexyoloproxy",
      cwd: input.cwd,
      resumeId: `resume-${input.goalTitle.toLowerCase().replaceAll(" ", "-")}`,
      pid: 4242,
      status: "running" as const,
      initialOutput: `started with ${input.prompt}`
    };
  }
}

describe("StewardRuntime", () => {
  it("turns a human goal into an auditable decision and Worker session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: new FakeWorkerAdapter(),
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });

      const dashboard = await store.dashboard();

      expect(goal.status).toBe("running");
      expect(dashboard.decisions).toHaveLength(1);
      expect(dashboard.decisions[0]).toMatchObject({
        goalId: goal.id,
        title: "Start Worker Agent for goal",
        risk: "medium",
        needsHumanReview: true,
        status: "active"
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        goalId: goal.id,
        decisionId: dashboard.decisions[0].id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/projects/agent-fleet",
        resumeId: "resume-bootstrap-agent-fleet",
        status: "running"
      });
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        workerSessionId: dashboard.workerSessions[0].id,
        repositoryPath: "/projects/agent-fleet",
        worktreePath: `/projects/agent-fleet/.worktrees/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        branchName: `agent-fleet/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        status: "planned"
      });
      expect(dashboard.stewardCheckpoints[0]).toMatchObject({
        reason: "dispatch",
        goalIds: [goal.id],
        workerSessionIds: [dashboard.workerSessions[0].id],
        nextAction: `Monitor Worker session ${dashboard.workerSessions[0].id}; resume with codexyoloproxy resume resume-bootstrap-agent-fleet if the Steward session is interrupted.`
      });
      expect(dashboard.events.map((event) => event.type)).toEqual([
        "goal.created",
        "decision.recorded",
        "worker.started",
        "worktree.planned",
        "goal.updated",
        "steward.checkpoint.recorded"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records human correction and creates a follow-up Steward decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: new FakeWorkerAdapter(),
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });
      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });
      const decision = (await store.dashboard()).decisions[0];

      const correction = await runtime.correctDecision({
        decisionId: decision.id,
        body: "Do not use Butler terminology. Use Steward Agent and Worker Agent."
      });

      const dashboard = await store.dashboard();

      expect(correction.body).toContain("Steward Agent");
      expect(dashboard.memories).toContainEqual(
        expect.objectContaining({
          scope: "user",
          key: "correction:terminology",
          value: "Do not use Butler terminology. Use Steward Agent and Worker Agent."
        })
      );
      expect(dashboard.decisions.map((item) => item.title)).toContain("Apply human correction");
      expect(dashboard.events.map((event) => event.type)).toContain("correction.recorded");
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject({
        reason: "correction",
        summary: "Human correction recorded for Steward decision.",
        nextAction: "Use the correction in future Worker instructions and recovery summaries."
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks the goal when the Worker command cannot start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start() {
            return {
              command: "missing-worker",
              cwd: "/worktrees/agent-fleet",
              resumeId: null,
              status: "failed" as const,
              pid: null,
              initialOutput: "Worker command not found: missing-worker"
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });
      const dashboard = await store.dashboard();

      expect(goal.status).toBe("blocked");
      expect(dashboard.workerSessions[0]).toMatchObject({
        command: "missing-worker",
        status: "failed",
        resumeId: null
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("completes the goal when the Worker process exits successfully", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start() {
            return {
              command: "codexyoloproxy",
              cwd: "/worktrees/agent-fleet",
              resumeId: "resume-completed",
              pid: 4343,
              status: "completed" as const,
              initialOutput: "Worker completed"
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });

      expect(goal.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("materializes a worktree before starting the Worker when a runner is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const events: string[] = [];
    const workerAdapter = new FakeWorkerAdapter();
    const runner: MaterializeWorktreeRunner = {
      pathExists: async () => {
        events.push("pathExists");
        return false;
      },
      ensureDir: async () => {
        events.push("ensureDir");
      },
      run: async () => {
        events.push("run");
        return {
          exitCode: 0,
          stdout: "created",
          stderr: ""
        };
      }
    };

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter,
        defaultWorkerCwd: "/repo/agent-fleet",
        defaultRepositoryPath: "/repo/agent-fleet",
        worktreeRoot: "/repo/agent-fleet/.worktrees",
        worktreeRunner: runner
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });

      const dashboard = await store.dashboard();
      events.push("assert");

      expect(workerAdapter.startInputs[0].cwd).toBe(dashboard.worktreeAssignments[0].worktreePath);
      expect(dashboard.workerSessions[0].cwd).toBe(dashboard.worktreeAssignments[0].worktreePath);
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        repositoryPath: "/projects/agent-fleet",
        status: "planned"
      });
      expect(dashboard.worktreeAssignments[0].branchName).toContain("agent-fleet/");
      expect(dashboard.worktreeAssignments[0].worktreePath).toContain("bootstrap-agent-fleet");
      expect(events.slice(0, 3)).toEqual(["pathExists", "ensureDir", "run"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
