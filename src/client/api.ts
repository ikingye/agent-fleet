import type { DashboardData, DecisionCorrection, Goal } from "../shared/types.js";

const emptyDashboard: DashboardData = {
  goals: [],
  decisions: [],
  workerSessions: [],
  corrections: [],
  memories: [],
  executionNodes: [],
  worktreeAssignments: [],
  events: []
};

export interface CreateGoalPayload {
  projectName: string;
  title: string;
  body: string;
}

export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard");

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard.");
  }

  const data = (await response.json()) as Partial<DashboardData>;

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
