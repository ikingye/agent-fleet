import type { RemoteHost, RemoteHostDiagnostics, RemoteProxyMode, Repository, Task } from "../shared/types.js";

export interface DashboardData {
  repositories: Repository[];
  tasks: Task[];
  remoteHosts: RemoteHost[];
}

export interface CreateRemoteHostPayload {
  name: string;
  sshHost: string;
  workRoot: string;
  proxyMode: RemoteProxyMode;
  proxyUrl: string | null;
  localForwardPort: number | null;
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
