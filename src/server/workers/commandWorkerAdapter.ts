import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { WorkerKind, WorkerSessionStatus } from "../../shared/types.js";

const ZSH_ALIAS_LOOKUP_TIMEOUT_MS = 2500;

export interface WorkerStartInput {
  goalTitle: string;
  prompt: string;
  cwd: string;
  env?: Readonly<Record<string, string | null | undefined>>;
}

export interface WorkerStartResult {
  command: string;
  cwd: string;
  resumeId: string | null;
  pid: number | null;
  status: Extract<WorkerSessionStatus, "running" | "completed" | "failed">;
  initialOutput: string;
  completion?: Promise<WorkerCompletion>;
}

export interface WorkerCompletion {
  status: Extract<WorkerSessionStatus, "completed" | "failed">;
  output: string;
}

export interface WorkerAdapter {
  readonly kind: WorkerKind;
  start(input: WorkerStartInput): Promise<WorkerStartResult>;
}

export function parseWorkerCommandArgs(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const character of value) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if ((character === "'" || character === '"') && quote === null) {
      quote = character;
      continue;
    }

    if (character === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(character) && quote === null) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote !== null) {
    throw new Error("AGENT_FLEET_WORKER_ARGS contains an unterminated quoted argument");
  }

  if (current !== "") {
    args.push(current);
  }

  return args;
}

export class CommandWorkerAdapter implements WorkerAdapter {
  readonly kind: WorkerKind = "codex";

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly startupTimeoutMs = 1500,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async start(input: WorkerStartInput): Promise<WorkerStartResult> {
    const resolution = await resolveCommand(this.command, this.args, this.env);

    if (resolution === null) {
      return {
        command: this.command,
        cwd: input.cwd,
        resumeId: null,
        pid: null,
        status: "failed",
        initialOutput: `Worker command not found: ${this.command}`
      };
    }

    return startWorkerProcess({
      command: resolution.command,
      args: resolution.args,
      displayCommand: resolution.displayCommand,
      cwd: input.cwd,
      prompt: input.prompt,
      startupTimeoutMs: this.startupTimeoutMs,
      env: mergeEnvironment(this.env, input.env)
    });
  }
}

interface StartWorkerProcessInput {
  command: string;
  args: string[];
  displayCommand: string;
  cwd: string;
  prompt: string;
  startupTimeoutMs: number;
  env: NodeJS.ProcessEnv;
}

interface ResolvedCommand {
  command: string;
  args: string[];
  displayCommand: string;
}

function extractResumeId(output: string): string | null {
  const match = output.match(/resume(?:[\s_-]+id)?\s*[:=]\s*([^\s]+)/i);

  return match?.[1] ?? null;
}

function startWorkerProcess(input: StartWorkerProcessInput): Promise<WorkerStartResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;
    let completionSettled = false;
    let complete!: (completion: WorkerCompletion) => void;
    const completion = new Promise<WorkerCompletion>((resolveCompletion) => {
      complete = resolveCompletion;
    });

    const settle = (status: WorkerStartResult["status"], extraOutput = "") => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      const initialOutput = `${output}${extraOutput}`;
      resolve({
        command: input.displayCommand,
        cwd: input.cwd,
        resumeId: extractResumeId(initialOutput),
        pid: child.pid ?? null,
        status,
        initialOutput,
        completion: status === "running" ? completion : undefined
      });
    };

    const settleCompletion = (status: WorkerCompletion["status"], extraOutput = "") => {
      if (completionSettled) {
        return;
      }

      completionSettled = true;
      complete({
        status,
        output: `${output}${extraOutput}`
      });
    };

    const timer = setTimeout(() => {
      const fallback = output.trim() === "" ? `Worker process started with pid ${child.pid ?? "unknown"}` : "";
      settle("running", fallback);
    }, input.startupTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      const extraOutput = `\nWorker process failed to start: ${error.message}`;
      settle("failed", extraOutput);
      settleCompletion("failed", extraOutput);
    });
    child.on("close", (code, signal) => {
      const suffix =
        code === 0
          ? ""
          : `\nWorker process exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`;
      settle(code === 0 ? "completed" : "failed", suffix);
      settleCompletion(code === 0 ? "completed" : "failed", suffix);
    });
    child.stdin.end(input.prompt);
  });
}

function mergeEnvironment(
  base: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | null | undefined>> | undefined
): NodeJS.ProcessEnv {
  if (overrides === undefined) {
    return base;
  }

  const merged: NodeJS.ProcessEnv = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) {
      delete merged[name];
    } else {
      merged[name] = value;
    }
  }

  return merged;
}

async function resolveCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<ResolvedCommand | null> {
  if (await isCommandAvailable(command, env)) {
    return {
      command,
      args,
      displayCommand: [command, ...args].join(" ")
    };
  }

  if (await isZshAliasAvailable(command, env)) {
    return {
      command: "zsh",
      args: ["-ic", [command, ...args.map(shellQuote)].join(" ")],
      displayCommand: [command, ...args].join(" ")
    };
  }

  return null;
}

function isSafeAliasName(command: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function isZshAliasAvailable(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (!isSafeAliasName(command)) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("zsh", ["-ic", `alias ${command}`], {
      env,
      stdio: ["ignore", "ignore", "ignore"]
    });
    const settle = (available: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(false);
    }, ZSH_ALIAS_LOOKUP_TIMEOUT_MS);

    child.on("error", () => {
      settle(false);
    });
    child.on("close", (code) => {
      settle(code === 0);
    });
  });
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isCommandAvailable(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (command.includes("/")) {
    return isExecutable(command);
  }

  const paths = env.PATH?.split(delimiter) ?? [];

  for (const path of paths) {
    if (await isExecutable(join(path, command))) {
      return true;
    }
  }

  return false;
}
