import { describe, expect, it } from "vitest";
import type { DashboardData, StewardCheckpoint, WorkerSession } from "../../shared/types.js";
import { buildStewardRecoveryReport } from "./recoveryRuntime.js";

function workerSession(overrides: Partial<WorkerSession>): WorkerSession {
  return {
    id: "worker-1",
    goalId: "goal-1",
    decisionId: "decision-1",
    kind: "codex",
    command: "codexyoloproxy",
    cwd: "/repo/agent-fleet/.worktrees/worker-1-recovery",
    pid: 4242,
    hostId: "local",
    resumeId: "resume-1",
    status: "running",
    lastOutput: "Worker started",
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:01:00.000Z",
    ...overrides
  };
}

function checkpoint(overrides: Partial<StewardCheckpoint>): StewardCheckpoint {
  return {
    id: "checkpoint-1",
    reason: "dispatch",
    summary: "Worker Agent is implementing crash recovery.",
    nextAction: "Inspect Worker Agent output and resume it if compact fails.",
    goalIds: ["goal-1"],
    workerSessionIds: ["worker-1"],
    createdAt: "2026-04-26T00:02:00.000Z",
    ...overrides
  };
}

function dashboard(overrides: Partial<DashboardData>): DashboardData {
  return {
    goals: [],
    decisions: [],
    workerSessions: [],
    corrections: [],
    memories: [],
    executionNodes: [],
    worktreeAssignments: [],
    stewardCheckpoints: [],
    events: [],
    ...overrides
  };
}

describe("buildStewardRecoveryReport", () => {
  it("reconstructs active Worker sessions, resume commands, worktrees, and next actions from durable state", () => {
    const report = buildStewardRecoveryReport(
      dashboard({
        goals: [
          {
            id: "goal-1",
            projectName: "agent-fleet",
            title: "Recover Steward context",
            body: "Make the Steward Agent restartable.",
            status: "running",
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:01:00.000Z"
          }
        ],
        workerSessions: [workerSession({ id: "worker-1", resumeId: "resume-1", status: "running" })],
        worktreeAssignments: [
          {
            id: "worktree-1",
            workerSessionId: "worker-1",
            repositoryPath: "/repo/agent-fleet",
            worktreePath: "/repo/agent-fleet/.worktrees/worker-1-recovery",
            branchName: "agent-fleet/worker-1-recovery",
            status: "active",
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:01:00.000Z"
          }
        ],
        stewardCheckpoints: [
          checkpoint({ id: "checkpoint-old", createdAt: "2026-04-26T00:01:00.000Z" }),
          checkpoint({ id: "checkpoint-latest", createdAt: "2026-04-26T00:03:00.000Z" })
        ]
      }),
      "2026-04-26T00:04:00.000Z"
    );

    expect(report).toMatchObject({
      generatedAt: "2026-04-26T00:04:00.000Z",
      lastCheckpoint: {
        id: "checkpoint-latest",
        nextAction: "Inspect Worker Agent output and resume it if compact fails."
      },
      activeGoalIds: ["goal-1"],
      activeGoals: [
        {
          id: "goal-1",
          projectName: "agent-fleet",
          title: "Recover Steward context",
          status: "running"
        }
      ],
      activeWorkerSessions: [
        {
          id: "worker-1",
          status: "running",
          cwd: "/repo/agent-fleet/.worktrees/worker-1-recovery",
          resumeId: "resume-1",
          resumeCommand: "codexyoloproxy resume resume-1",
          worktreeAssignmentId: "worktree-1",
          repositoryPath: "/repo/agent-fleet",
          worktreePath: "/repo/agent-fleet/.worktrees/worker-1-recovery",
          branchName: "agent-fleet/worker-1-recovery",
          worktreeStatus: "active"
        }
      ]
    });
    expect(report.nextActions).toEqual([
      "Checkpoint: Inspect Worker Agent output and resume it if compact fails.",
      "Inspect Worker session worker-1 in /repo/agent-fleet/.worktrees/worker-1-recovery; if the process is gone, run: codexyoloproxy resume resume-1"
    ]);
  });

  it("returns an explicit no-active-worker action when recovery has no resumable Worker sessions", () => {
    const report = buildStewardRecoveryReport(
      dashboard({
        goals: [
          {
            id: "goal-blocked",
            projectName: "agent-fleet",
            title: "Recover Steward context",
            body: "Make the Steward Agent restartable.",
            status: "blocked",
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:01:00.000Z"
          }
        ],
        workerSessions: [workerSession({ id: "worker-failed", status: "failed", resumeId: null })]
      }),
      "2026-04-26T00:04:00.000Z"
    );

    expect(report.activeGoalIds).toEqual(["goal-blocked"]);
    expect(report.activeGoals).toEqual([
      expect.objectContaining({
        id: "goal-blocked",
        status: "blocked",
        title: "Recover Steward context"
      })
    ]);
    expect(report.activeWorkerSessions).toEqual([]);
    expect(report.nextActions).toEqual([
      "No active Worker sessions. Review queued, running, or blocked goals and decide whether to dispatch a new Worker Agent."
    ]);
  });
});
