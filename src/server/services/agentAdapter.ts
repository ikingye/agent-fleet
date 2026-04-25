import type { AgentKind } from "../../shared/types.js";

export interface AgentStartInput {
  taskId: string;
  worktreePath: string;
  prompt: string;
  logPath: string;
}

export interface AgentRunResult {
  kind: AgentKind;
  status: "succeeded" | "failed";
  output: string;
  logPath: string;
}

export interface AgentAdapter {
  kind: AgentKind;
  detect(): Promise<{ available: boolean; version: string | null; message: string }>;
  start(input: AgentStartInput): Promise<AgentRunResult>;
}
