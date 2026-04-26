export type GoalStatus = "queued" | "running" | "blocked" | "completed" | "cancelled";
export type WorkerKind = "codex" | "claude_code" | "gemini_cli";
export type WorkerSessionStatus = "starting" | "running" | "paused" | "completed" | "failed";
export type DecisionRisk = "low" | "medium" | "high";
export type DecisionStatus = "active" | "corrected" | "superseded";
export type MemoryScope = "user" | "project";

export interface Goal {
  id: string;
  projectName: string;
  title: string;
  body: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StewardDecision {
  id: string;
  goalId: string;
  workerSessionId: string | null;
  title: string;
  rationale: string;
  risk: DecisionRisk;
  confidence: number;
  reversible: boolean;
  needsHumanReview: boolean;
  status: DecisionStatus;
  actionsJson: string;
  createdAt: string;
}

export interface WorkerSession {
  id: string;
  goalId: string;
  decisionId: string;
  kind: WorkerKind;
  command: string;
  cwd: string;
  pid: number | null;
  hostId: string | null;
  resumeId: string | null;
  status: WorkerSessionStatus;
  lastOutput: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionCorrection {
  id: string;
  decisionId: string;
  body: string;
  createdBy: "human" | "steward";
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  projectName: string | null;
  key: string;
  value: string;
  sourceCorrectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionNode {
  id: string;
  name: string;
  kind: "local" | "remote";
  status: "ready" | "offline" | "unknown";
  sshHost: string | null;
  workRoot: string;
  proxyUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneEvent {
  id: string;
  type: string;
  goalId: string | null;
  decisionId: string | null;
  workerSessionId: string | null;
  message: string;
  metadataJson: string;
  createdAt: string;
}

export interface DashboardData {
  goals: Goal[];
  decisions: StewardDecision[];
  workerSessions: WorkerSession[];
  corrections: DecisionCorrection[];
  memories: MemoryEntry[];
  executionNodes: ExecutionNode[];
  events: ControlPlaneEvent[];
}
