import type { WorkerKind } from "../../shared/types.js";

export interface BuildResumeCommandInput {
  kind: WorkerKind;
  baseCommand: string;
  resumeId: string | null;
}

export function buildResumeCommand(input: BuildResumeCommandInput): string | null {
  if (input.resumeId === null || input.resumeId.trim() === "") {
    return null;
  }

  if (input.kind === "codex") {
    return `${input.baseCommand} resume ${shellArg(input.resumeId)}`;
  }

  return `${input.baseCommand} resume ${shellArg(input.resumeId)}`;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
