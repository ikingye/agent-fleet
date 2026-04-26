import type { WorkerKind } from "../../shared/types.js";
import { parseWorkerCommandArgs } from "./commandWorkerAdapter.js";

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
    const codexExecResumeCommand = buildCodexExecResumeCommand(input.baseCommand, input.resumeId);

    if (codexExecResumeCommand !== null) {
      return codexExecResumeCommand;
    }

    return `${input.baseCommand} resume ${shellArg(input.resumeId)}`;
  }

  return `${input.baseCommand} resume ${shellArg(input.resumeId)}`;
}

function buildCodexExecResumeCommand(baseCommand: string, resumeId: string): string | null {
  const parts = parseWorkerCommandArgs(baseCommand);

  if (parts.length < 2 || parts[1] !== "exec" || !parts[0].endsWith("codex")) {
    return null;
  }

  const withoutPromptPlaceholder = parts.at(-1) === "-" ? parts.slice(0, -1) : parts;

  return [...withoutPromptPlaceholder, "resume", resumeId].map(shellArg).join(" ");
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
