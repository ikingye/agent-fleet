import type { DashboardData, WorkerSession, WorkerSessionStatus } from "../../shared/types.js";

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

    await input.updateWorkerSessionStatus(update);
    result.updated += 1;
  }

  return result;
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
