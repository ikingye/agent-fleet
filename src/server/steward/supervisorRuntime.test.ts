import { describe, expect, it } from "vitest";
import type { DashboardData, WorkerSession } from "../../shared/types.js";
import { reconcileWorkerSessions } from "./supervisorRuntime.js";

function workerSession(overrides: Partial<WorkerSession>): WorkerSession {
  return {
    id: "worker-1",
    goalId: "goal-1",
    decisionId: "decision-1",
    kind: "codex",
    command: "codexyoloproxy",
    cwd: "/worktrees/agent-fleet",
    pid: 4242,
    hostId: "local",
    resumeId: "resume-1",
    status: "running",
    lastOutput: "Worker started",
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides
  };
}

function dashboardWith(workerSessions: WorkerSession[]): DashboardData {
  return {
    goals: [],
    decisions: [],
    workerSessions,
    corrections: [],
    memories: [],
    executionNodes: [],
    worktreeAssignments: [],
    stewardCheckpoints: [],
    agentArtifacts: [],
    reviews: [],
    deliveryReports: [],
    events: []
  };
}

describe("reconcileWorkerSessions", () => {
  it("marks a stale running Worker session paused when the process probe cannot find a resumable process", async () => {
    const running = workerSession({
      id: "worker-running",
      status: "running",
      pid: 4242,
      resumeId: "resume-running"
    });
    const completed = workerSession({ id: "worker-completed", status: "completed", pid: null });
    const probeCalls: string[] = [];
    const updates: Array<{ workerSessionId: string; status: string; lastOutput?: string }> = [];

    const result = await reconcileWorkerSessions({
      dashboard: dashboardWith([running, completed]),
      async probeProcess(session) {
        probeCalls.push(session.id);
        return {
          status: "missing",
          message: `pid ${session.pid} is no longer running`
        };
      },
      async updateWorkerSessionStatus(input) {
        updates.push(input);
        return {
          ...running,
          status: input.status,
          lastOutput: input.lastOutput ?? running.lastOutput,
          updatedAt: "2026-04-26T00:01:00.000Z"
        };
      }
    });

    expect(probeCalls).toEqual(["worker-running"]);
    expect(updates).toEqual([
      {
        workerSessionId: "worker-running",
        status: "paused",
        lastOutput: "pid 4242 is no longer running"
      }
    ]);
    expect(result).toEqual({
      checked: 1,
      updated: 1,
      staleSessionIds: ["worker-running"],
      runningSessionIds: []
    });
  });

  it("marks a stale running Worker session failed when no resume id is available", async () => {
    const running = workerSession({
      id: "worker-unresumable",
      status: "running",
      pid: 5252,
      resumeId: null
    });
    const updates: Array<{ workerSessionId: string; status: string; lastOutput?: string }> = [];

    const result = await reconcileWorkerSessions({
      dashboard: dashboardWith([running]),
      async probeProcess(session) {
        return {
          status: "missing",
          message: `pid ${session.pid} is no longer running`
        };
      },
      async updateWorkerSessionStatus(input) {
        updates.push(input);
        return {
          ...running,
          status: input.status,
          lastOutput: input.lastOutput ?? running.lastOutput,
          updatedAt: "2026-04-26T00:01:00.000Z"
        };
      }
    });

    expect(updates).toEqual([
      {
        workerSessionId: "worker-unresumable",
        status: "failed",
        lastOutput: "pid 5252 is no longer running"
      }
    ]);
    expect(result).toEqual({
      checked: 1,
      updated: 1,
      staleSessionIds: ["worker-unresumable"],
      runningSessionIds: []
    });
  });
});
