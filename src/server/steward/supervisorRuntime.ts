import type { DashboardData, GoalStatus, WorkerSession, WorkerSessionStatus } from "../../shared/types.js";

export type WorkerProcessObservation =
  | {
      status: "running";
      lastOutput?: string;
    }
  | {
      status: "completed" | "failed" | "missing";
      message?: string;
      lastOutput?: string;
    };

export interface WorkerSessionStatusUpdate {
  workerSessionId: string;
  status: WorkerSessionStatus;
  lastOutput?: string;
}

export interface SupervisorReconcileInput {
  dashboard: DashboardData;
  probeProcess(session: WorkerSession): Promise<WorkerProcessObservation>;
  updateWorkerSessionStatus(input: WorkerSessionStatusUpdate): Promise<WorkerSession>;
  updateGoalStatus?(goalId: string, status: GoalStatus): Promise<unknown>;
}

export interface SupervisorReconcileResult {
  checked: number;
  updated: number;
  staleSessionIds: string[];
  runningSessionIds: string[];
}

const supervisedStatuses = new Set<WorkerSessionStatus>(["starting", "running"]);

export async function reconcileWorkerSessions(input: SupervisorReconcileInput): Promise<SupervisorReconcileResult> {
  const result: SupervisorReconcileResult = {
    checked: 0,
    updated: 0,
    staleSessionIds: [],
    runningSessionIds: []
  };

  for (const session of input.dashboard.workerSessions) {
    if (!supervisedStatuses.has(session.status)) {
      continue;
    }

    result.checked += 1;

    const observation = await input.probeProcess(session);
    const update = buildStatusUpdate(session, observation);

    if (observation.status === "running") {
      result.runningSessionIds.push(session.id);
    }

    if (observation.status === "missing") {
      result.staleSessionIds.push(session.id);
    }

    if (update === null) {
      continue;
    }

    const updatedSession = await input.updateWorkerSessionStatus(update);
    if (input.updateGoalStatus !== undefined) {
      await input.updateGoalStatus(updatedSession.goalId, goalStatusForWorkerSessionStatus(updatedSession.status));
    }
    result.updated += 1;
  }

  return result;
}

function goalStatusForWorkerSessionStatus(status: WorkerSessionStatus): GoalStatus {
  if (status === "completed") {
    return "completed";
  }

  if (status === "starting" || status === "running") {
    return "running";
  }

  return "blocked";
}

export async function probeLocalWorkerProcess(session: WorkerSession): Promise<WorkerProcessObservation> {
  if (session.pid === null) {
    return {
      status: "missing",
      message: "Worker process is missing"
    };
  }

  try {
    process.kill(session.pid, 0);

    return {
      status: "running"
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return {
        status: "running"
      };
    }

    return {
      status: "missing",
      message: `pid ${session.pid} is no longer running`
    };
  }
}

function buildStatusUpdate(
  session: WorkerSession,
  observation: WorkerProcessObservation
): WorkerSessionStatusUpdate | null {
  if (observation.status === "running") {
    if (session.status === "running" && observation.lastOutput === undefined) {
      return null;
    }

    return {
      workerSessionId: session.id,
      status: "running",
      lastOutput: observation.lastOutput
    };
  }

  if (observation.status === "missing") {
    return {
      workerSessionId: session.id,
      status: session.resumeId === null ? "failed" : "paused",
      lastOutput:
        observation.lastOutput ??
        observation.message ??
        `Worker process ${session.pid === null ? "is missing" : `pid ${session.pid} is missing`}`
    };
  }

  return {
    workerSessionId: session.id,
    status: observation.status,
    lastOutput: observation.lastOutput ?? observation.message
  };
}
