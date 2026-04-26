import type { DashboardData, DecisionCorrection, ExecutionNode, Goal, StewardMessage, WorkerReport } from "../shared/types.js";

export type { StewardMessage };

export interface ClientGoal extends Goal {
  workspacePath?: string;
}

export interface ClientExecutionNode extends ExecutionNode {
  lastHighLevelNote?: string | null;
  lastNote?: string | null;
  note?: string | null;
}

export interface ClientDashboardData extends Omit<DashboardData, "executionNodes" | "goals" | "workerReports"> {
  executionNodes: ClientExecutionNode[];
  goals: ClientGoal[];
  workerReports: WorkerReport[];
  stewardMessages: StewardMessage[];
}

const emptyDashboard: ClientDashboardData = {
  goals: [],
  decisions: [],
  workerSessions: [],
  corrections: [],
  memories: [],
  executionNodes: [],
  worktreeAssignments: [],
  stewardCheckpoints: [],
  workerReports: [],
  agentArtifacts: [],
  reviews: [],
  deliveryReports: [],
  stewardMessages: [],
  events: []
};

export interface CreateGoalPayload {
  projectName: string;
  workspacePath: string;
  title: string;
  body: string;
}

export interface SendStewardMessagePayload {
  body: string;
  projectName?: string;
  workspacePath?: string;
  goalId?: string;
}

export interface SendStewardMessageResponse {
  ownerMessage: StewardMessage;
  stewardMessage: StewardMessage;
}

export type RegisterExecutionNodePayload = Omit<ExecutionNode, "id" | "createdAt" | "updatedAt">;

export async function fetchDashboard(): Promise<ClientDashboardData> {
  const response = await fetch("/api/dashboard");

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard.");
  }

  const data = (await response.json()) as Partial<ClientDashboardData>;

  return {
    ...emptyDashboard,
    ...data,
    goals: data.goals ?? [],
    decisions: data.decisions ?? [],
    workerSessions: data.workerSessions ?? [],
    corrections: data.corrections ?? [],
    memories: data.memories ?? [],
    executionNodes: data.executionNodes ?? [],
    worktreeAssignments: data.worktreeAssignments ?? [],
    stewardCheckpoints: data.stewardCheckpoints ?? [],
    workerReports: data.workerReports ?? [],
    agentArtifacts: data.agentArtifacts ?? [],
    reviews: data.reviews ?? [],
    deliveryReports: data.deliveryReports ?? [],
    stewardMessages: data.stewardMessages ?? [],
    events: data.events ?? []
  };
}

export async function createGoal(payload: CreateGoalPayload): Promise<Goal> {
  const response = await fetch("/api/goals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to create goal.");
  }

  return response.json() as Promise<Goal>;
}

export async function sendStewardMessage(payload: SendStewardMessagePayload): Promise<SendStewardMessageResponse> {
  const response = await fetch("/api/steward/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to send Steward message.");
  }

  return response.json() as Promise<SendStewardMessageResponse>;
}

export async function correctDecision(decisionId: string, body: string): Promise<DecisionCorrection> {
  const response = await fetch(`/api/decisions/${decisionId}/corrections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body })
  });

  if (!response.ok) {
    throw new Error("Failed to send correction.");
  }

  return response.json() as Promise<DecisionCorrection>;
}

export async function registerExecutionNode(payload: RegisterExecutionNodePayload): Promise<ExecutionNode> {
  const response = await fetch("/api/execution-nodes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to register execution node.");
  }

  return response.json() as Promise<ExecutionNode>;
}

async function postOwnerAction(path: string, failureMessage: string): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(failureMessage);
  }

  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function runAutonomyTick(): Promise<unknown> {
  return postOwnerAction("/api/steward/autonomy/run", "Failed to run autonomy tick.");
}

export async function reconcileRecovery(): Promise<unknown> {
  return postOwnerAction("/api/recovery/reconcile", "Failed to reconcile recovery.");
}
