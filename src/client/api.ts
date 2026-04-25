import type { Repository, Task } from "../shared/types.js";

export interface DashboardData {
  repositories: Repository[];
  tasks: Task[];
}

export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard");

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard data.");
  }

  return response.json() as Promise<DashboardData>;
}

export async function createTask(repositoryId: string, title: string, goal: string): Promise<Task> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ repositoryId, title, goal })
  });

  if (!response.ok) {
    throw new Error("Failed to queue task.");
  }

  return response.json() as Promise<Task>;
}
