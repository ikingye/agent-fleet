import { describe, expect, it } from "vitest";
import type { DashboardData, ExecutionNode, WorkerSession } from "../../shared/types.js";
import type { WorkerProcessObservation } from "./supervisorRuntime.js";
import { createDashboardWorkerProcessProbe } from "./remoteSupervisorRuntime.js";

describe("createDashboardWorkerProcessProbe", () => {
  it("uses the execution node sshHost and remote pid for remote Worker sessions", async () => {
    const remoteProbeCalls: Array<{ sshHost: string; pid: number }> = [];
    const localProbeCalls: string[] = [];
    const probe = createDashboardWorkerProcessProbe({
      dashboard: dashboardWith({
        executionNodes: [
          executionNode({
            id: "node-1",
            sshHost: "worker@builder.internal"
          })
        ]
      }),
      async localProbe(session) {
        localProbeCalls.push(session.id);
        return { status: "running" };
      },
      async remotePidProbe(input) {
        remoteProbeCalls.push(input);
        return {
          status: "missing",
          message: "remote pid 7777 is no longer running on worker@builder.internal"
        };
      }
    });

    const observation = await probe(
      workerSession({
        id: "remote-worker",
        hostId: "node-1",
        pid: 7777
      })
    );

    expect(localProbeCalls).toEqual([]);
    expect(remoteProbeCalls).toEqual([{ sshHost: "worker@builder.internal", pid: 7777 }]);
    expect(observation).toEqual({
      status: "missing",
      message: "remote pid 7777 is no longer running on worker@builder.internal"
    });
  });

  it("reports a remote Worker as missing when its remote pid was never captured", async () => {
    const probe = createDashboardWorkerProcessProbe({
      dashboard: dashboardWith({
        executionNodes: [executionNode({ id: "node-1" })]
      }),
      localProbe: unexpectedLocalProbe,
      async remotePidProbe() {
        throw new Error("remote probe should not be called without a pid");
      }
    });

    await expect(
      probe(
        workerSession({
          id: "remote-worker",
          hostId: "node-1",
          pid: null
        })
      )
    ).resolves.toEqual({
      status: "missing",
      message: "Remote Worker process pid is missing"
    });
  });

  it("falls back to the local probe for local Worker sessions", async () => {
    const probe = createDashboardWorkerProcessProbe({
      dashboard: dashboardWith({ executionNodes: [] }),
      async localProbe(session) {
        return {
          status: "missing",
          message: `pid ${session.pid} is no longer running`
        };
      },
      async remotePidProbe() {
        throw new Error("remote probe should not be called for local sessions");
      }
    });

    await expect(probe(workerSession({ hostId: null, pid: 4242 }))).resolves.toEqual({
      status: "missing",
      message: "pid 4242 is no longer running"
    });
  });
});

function dashboardWith(overrides: Partial<DashboardData>): DashboardData {
  return {
    goals: [],
    decisions: [],
    workerSessions: [],
    corrections: [],
    memories: [],
    executionNodes: [],
    githubDeployKeyLeases: [],
    worktreeAssignments: [],
    stewardCheckpoints: [],
    agentArtifacts: [],
    reviews: [],
    deliveryReports: [],
    events: [],
    ...overrides
  };
}

function workerSession(overrides: Partial<WorkerSession> = {}): WorkerSession {
  return {
    id: "worker-1",
    goalId: "goal-1",
    decisionId: "decision-1",
    kind: "codex",
    command: "codex",
    cwd: "/workspace",
    pid: 4242,
    hostId: null,
    resumeId: "resume-1",
    status: "running",
    lastOutput: "Worker started",
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides
  };
}

function executionNode(overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: "node-1",
    name: "builder",
    kind: "remote",
    status: "ready",
    sshHost: "worker@builder.internal",
    workRoot: "/srv/agent-fleet",
    proxyUrl: null,
    tags: ["remote"],
    capacity: 2,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides
  };
}

async function unexpectedLocalProbe(): Promise<WorkerProcessObservation> {
  throw new Error("local probe should not be called for remote sessions");
}
