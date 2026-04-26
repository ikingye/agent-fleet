import { spawn } from "node:child_process";
import type { WorkerKind } from "../../shared/types.js";
import type { WorkerAdapter, WorkerStartInput, WorkerStartResult } from "./commandWorkerAdapter.js";

export interface BuildSshWorkerCommandInput {
  sshHost: string;
  cwd: string;
  workerCommand: string;
  workerArgs?: readonly string[];
  sshCommand?: string;
  sshArgs?: readonly string[];
  proxyEnv?: Readonly<Record<string, string | null | undefined>>;
}

export interface BuiltSshWorkerCommand {
  command: string;
  args: string[];
  displayCommand: string;
  remoteCommand: string;
}

export interface SshWorkerProcessInput {
  command: string;
  args: string[];
  stdin: string;
  startupTimeoutMs: number;
}

export interface SshWorkerProcessResult {
  status: WorkerStartResult["status"];
  output: string;
  pid: number | null;
}

export interface SshWorkerProcessRunner {
  run(input: SshWorkerProcessInput): Promise<SshWorkerProcessResult>;
}

export interface RemoteSshWorkerAdapterOptions {
  sshHost: string;
  workerCommand: string;
  workerArgs?: readonly string[];
  sshCommand?: string;
  sshArgs?: readonly string[];
  proxyEnv?: Readonly<Record<string, string | null | undefined>>;
  startupTimeoutMs?: number;
  kind?: WorkerKind;
  runner?: SshWorkerProcessRunner;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 1500;
const REMOTE_PID_PREFIX = "agent-fleet remote pid:";

export class RemoteSshWorkerAdapter implements WorkerAdapter {
  readonly kind: WorkerKind;

  private readonly startupTimeoutMs: number;
  private readonly runner: SshWorkerProcessRunner;

  constructor(private readonly options: RemoteSshWorkerAdapterOptions) {
    this.kind = options.kind ?? "codex";
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.runner = options.runner ?? new ChildProcessSshWorkerRunner();
  }

  async start(input: WorkerStartInput): Promise<WorkerStartResult> {
    const built = buildSshWorkerCommand({
      sshHost: this.options.sshHost,
      sshCommand: this.options.sshCommand,
      sshArgs: this.options.sshArgs,
      cwd: input.cwd,
      workerCommand: this.options.workerCommand,
      workerArgs: this.options.workerArgs,
      proxyEnv: this.options.proxyEnv
    });
    const processResult = await this.runner.run({
      command: built.command,
      args: built.args,
      stdin: input.prompt,
      startupTimeoutMs: this.startupTimeoutMs
    });

    return {
      command: built.displayCommand,
      cwd: input.cwd,
      resumeId: extractResumeId(processResult.output),
      pid: processResult.pid ?? extractRemotePid(processResult.output),
      status: processResult.status,
      initialOutput: processResult.output
    };
  }
}

export class ChildProcessSshWorkerRunner implements SshWorkerProcessRunner {
  run(input: SshWorkerProcessInput): Promise<SshWorkerProcessResult> {
    return new Promise((resolve) => {
      const child = spawn(input.command, input.args, {
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
        const settledOutput = `${output}${extraOutput}`;
        resolve({
          status,
          output: settledOutput,
          pid: extractRemotePid(settledOutput)
        });
      };

      const timer = setTimeout(() => {
        const fallback =
          extractRemotePid(output) === null
            ? `\nRemote Worker pid was not reported; local ssh client pid ${
                child.pid ?? "unknown"
              } cannot be used for remote lifecycle checks.`
            : "";
        settle("running", fallback);
      }, input.startupTimeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        settle("failed", `\nSSH worker process failed to start: ${error.message}`);
      });
      child.on("close", (code, signal) => {
        const suffix =
          code === 0
            ? ""
            : `\nSSH worker process exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`;
        settle(code === 0 ? "completed" : "failed", suffix);
      });
      child.stdin.end(input.stdin);
    });
  }
}

export function buildSshWorkerCommand(input: BuildSshWorkerCommandInput): BuiltSshWorkerCommand {
  const sshCommand = normalizeRequired("sshCommand", input.sshCommand ?? "ssh");
  const sshHost = normalizeRequired("sshHost", input.sshHost);
  const cwd = normalizeRequired("cwd", input.cwd);
  const workerCommand = normalizeRequired("workerCommand", input.workerCommand);

  if (sshHost.startsWith("-")) {
    throw new Error("sshHost must not start with '-'");
  }

  const workerInvocation = [workerCommand, ...(input.workerArgs ?? [])].map(shellQuote).join(" ");
  const proxyAssignments = buildProxyAssignments(input.proxyEnv ?? {});
  const envPrefix = proxyAssignments.length === 0 ? "" : `env ${proxyAssignments.join(" ")} `;
  const script = [
    `cd ${shellQuote(cwd)} && {`,
    `${envPrefix}${workerInvocation} &`,
    "agent_fleet_worker_pid=$!",
    `printf '\\n${REMOTE_PID_PREFIX} %s\\n' "$agent_fleet_worker_pid"`,
    'wait "$agent_fleet_worker_pid"',
    "}"
  ].join(" ");
  const remoteCommand = `sh -lc ${shellQuote(script)}`;
  const args = [...(input.sshArgs ?? []), sshHost, remoteCommand];

  return {
    command: sshCommand,
    args,
    displayCommand: [sshCommand, ...(input.sshArgs ?? []), sshHost, workerCommand, ...(input.workerArgs ?? [])].join(" "),
    remoteCommand
  };
}

function buildProxyAssignments(proxyEnv: Readonly<Record<string, string | null | undefined>>): string[] {
  return Object.entries(proxyEnv)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([name, value]) => {
      if (value === null || value === undefined || value.trim() === "") {
        return [];
      }

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`Invalid proxy environment variable name: ${name}`);
      }

      return [`${name}=${shellQuote(value.trim())}`];
    });
}

function extractResumeId(output: string): string | null {
  const match = output.match(/resume(?:[\s_-]+id)?\s*[:=]\s*([^\s]+)/i);

  return match?.[1] ?? null;
}

function extractRemotePid(output: string): number | null {
  const match = output.match(/agent-fleet remote pid:\s*(\d+)/i);

  if (match === null) {
    return null;
  }

  const pid = Number.parseInt(match[1], 10);

  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function normalizeRequired(name: string, value: string): string {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
