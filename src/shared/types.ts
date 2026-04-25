export type TaskState =
  | "queued"
  | "planned"
  | "worktree_ready"
  | "agent_running"
  | "changes_ready"
  | "checks_running"
  | "reviewing"
  | "merge_ready"
  | "merged"
  | "pushed"
  | "blocked"
  | "needs_clarification"
  | "retrying"
  | "failed";

export type AgentKind = "codex" | "claude_code" | "gemini_cli";

export type CheckStatus = "passed" | "failed" | "unavailable";

export type RemoteProxyMode = "direct" | "http_proxy" | "auto";

export type RemoteCheckStatus = "passed" | "failed" | "warning";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Repository {
  id: string;
  projectId: string;
  name: string;
  rootPath: string;
  remoteUrl: string | null;
  mainBranch: string;
  createdAt: string;
}

export interface Task {
  id: string;
  repositoryId: string;
  title: string;
  goal: string;
  state: TaskState;
  source: "local" | "github_issue";
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  actor: "user" | "orchestrator" | "worker" | "quality_gate" | "reviewer" | "github";
  state: TaskState;
  message: string;
  metadataJson: string;
  createdAt: string;
}

export interface DispatcherStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunHadTask: boolean | null;
  lastError: string | null;
}

export interface WorktreeRecord {
  id: string;
  taskId: string;
  repositoryId: string;
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
  removedAt: string | null;
}

export interface AgentRun {
  id: string;
  taskId: string;
  kind: AgentKind;
  status: "running" | "succeeded" | "failed" | "stopped";
  worktreePath: string;
  logPath: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface CheckRun {
  id: string;
  taskId: string;
  name: string;
  command: string;
  status: CheckStatus;
  output: string;
  createdAt: string;
}

export interface RemoteHost {
  id: string;
  name: string;
  sshHost: string;
  workRoot: string;
  proxyMode: RemoteProxyMode;
  proxyUrl: string | null;
  localForwardPort: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteHostCheck {
  name: string;
  status: RemoteCheckStatus;
  message: string;
  output: string;
}

export interface RemoteHostDiagnostics {
  host: RemoteHost;
  checks: RemoteHostCheck[];
  recommendedEnvironment: Record<string, string>;
  checkedAt: string;
}
