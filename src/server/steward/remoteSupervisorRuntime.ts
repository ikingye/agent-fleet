import type { DashboardData, WorkerSession } from "../../shared/types.js";
import type { WorkerProcessObservation } from "./supervisorRuntime.js";

export interface RemotePidProbeInput {
  sshHost: string;
  pid: number;
}

export interface DashboardWorkerProcessProbeInput {
  dashboard: DashboardData;
  localProbe(session: WorkerSession): Promise<WorkerProcessObservation>;
  remotePidProbe(input: RemotePidProbeInput): Promise<WorkerProcessObservation>;
}

export function createDashboardWorkerProcessProbe(
  input: DashboardWorkerProcessProbeInput
): (session: WorkerSession) => Promise<WorkerProcessObservation> {
  return async (session) => {
    if (session.hostId === null || session.hostId === "local") {
      return input.localProbe(session);
    }

    const node = input.dashboard.executionNodes.find((item) => item.id === session.hostId);

    if (node === undefined) {
      return {
        status: "missing",
        message: `Remote execution node ${session.hostId} is not registered`
      };
    }

    const sshHost = node.sshHost?.trim();

    if (sshHost === undefined || sshHost === "") {
      return {
        status: "missing",
        message: `Remote execution node ${session.hostId} is missing sshHost`
      };
    }

    if (session.pid === null) {
      return {
        status: "missing",
        message: "Remote Worker process pid is missing"
      };
    }

    return input.remotePidProbe({
      sshHost,
      pid: session.pid
    });
  };
}
