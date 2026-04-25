import type { RemoteHost, RemoteHostDiagnostics, RemoteProxyMode, Repository, Task, TaskEvent } from "../shared/types.js";

export interface DashboardData {
  repositories: Repository[];
  tasks: Task[];
  taskEventsByTaskId: Record<string, TaskEvent[]>;
  remoteHosts: RemoteHost[];
}

export interface CreateRepositoryPayload {
  projectName: string;
  name: string;
  rootPath: string;
  remoteUrl: string | null;
  mainBranch: string;
}

export interface CreateRemoteHostPayload {
  name: string;
  sshHost: string;
  workRoot: string;
  proxyMode: RemoteProxyMode;
  proxyUrl: string | null;
  localForwardPort: number | null;
}

export interface OrchestratorRunResult {
  ran: boolean;
}

export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard");

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard data.");
  }

  return response.json() as Promise<DashboardData>;
}

export async function runOrchestratorOnce(): Promise<OrchestratorRunResult> {
  const response = await fetch("/api/orchestrator/run-once", {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Failed to run orchestrator.");
  }

  return response.json() as Promise<OrchestratorRunResult>;
}

export async function createRepository(payload: CreateRepositoryPayload): Promise<Repository> {
  const response = await fetch("/api/repositories", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to register repository.");
  }

  return response.json() as Promise<Repository>;
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

export async function createRemoteHost(payload: CreateRemoteHostPayload): Promise<RemoteHost> {
  const response = await fetch("/api/remote-hosts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to register remote host.");
  }

  return response.json() as Promise<RemoteHost>;
}

export async function checkRemoteHost(id: string): Promise<RemoteHostDiagnostics> {
  const response = await fetch(`/api/remote-hosts/${id}/check`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Failed to check remote host.");
  }

  return response.json() as Promise<RemoteHostDiagnostics>;
}
