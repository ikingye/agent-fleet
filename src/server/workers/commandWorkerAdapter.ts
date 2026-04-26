import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { WorkerKind, WorkerSessionStatus } from "../../shared/types.js";

export interface WorkerStartInput {
  goalTitle: string;
  prompt: string;
  cwd: string;
}

export interface WorkerStartResult {
  command: string;
  cwd: string;
  resumeId: string | null;
  pid: number | null;
  status: Extract<WorkerSessionStatus, "running" | "completed" | "failed">;
  initialOutput: string;
}

export interface WorkerAdapter {
  readonly kind: WorkerKind;
  start(input: WorkerStartInput): Promise<WorkerStartResult>;
}

export class CommandWorkerAdapter implements WorkerAdapter {
  readonly kind: WorkerKind = "codex";

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly startupTimeoutMs = 1500
  ) {}

  async start(input: WorkerStartInput): Promise<WorkerStartResult> {
    const resolution = await resolveCommand(this.command, this.args);

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
      startupTimeoutMs: this.startupTimeoutMs
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
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;

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
        initialOutput
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
      settle("failed", `\nWorker process failed to start: ${error.message}`);
    });
    child.on("close", (code, signal) => {
      const suffix =
        code === 0
          ? ""
          : `\nWorker process exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`;
      settle(code === 0 ? "completed" : "failed", suffix);
    });
    child.stdin.end(input.prompt);
  });
}

async function resolveCommand(command: string, args: string[]): Promise<ResolvedCommand | null> {
  if (await isCommandAvailable(command)) {
    return {
      command,
      args,
      displayCommand: [command, ...args].join(" ")
    };
  }

  if (await isZshAliasAvailable(command)) {
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

async function isZshAliasAvailable(command: string): Promise<boolean> {
  if (!isSafeAliasName(command)) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("zsh", ["-ic", `alias ${command}`], {
      env: process.env,
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
    }, 1000);

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

async function isCommandAvailable(command: string): Promise<boolean> {
  if (command.includes("/")) {
    return isExecutable(command);
  }

  const paths = process.env.PATH?.split(delimiter) ?? [];

  for (const path of paths) {
    if (await isExecutable(join(path, command))) {
      return true;
    }
  }

  return false;
}
