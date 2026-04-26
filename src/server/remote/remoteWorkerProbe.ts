import { spawn } from "node:child_process";
import type { WorkerProcessObservation } from "../steward/supervisorRuntime.js";

export interface RemoteCommandInput {
  sshHost: string;
  remoteScript: string;
}

export interface RemoteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RemoteCommandRunner {
  run(input: RemoteCommandInput): Promise<RemoteCommandResult>;
}

export interface ProbeRemoteWorkerPidInput {
  sshHost: string;
  pid: number;
  runner?: RemoteCommandRunner;
}

export async function probeRemoteWorkerPid(input: ProbeRemoteWorkerPidInput): Promise<WorkerProcessObservation> {
  const sshHost = normalizeSshHost(input.sshHost);
  const pid = normalizePid(input.pid);
  const runner = input.runner ?? new SshRemoteCommandRunner();
  const result = await runner.run({
    sshHost,
    remoteScript: `kill -0 ${pid}`
  });

  if (result.exitCode === 0) {
    return { status: "running" };
  }

  return {
    status: "missing",
    message: `remote pid ${pid} is no longer running on ${sshHost}`
  };
}

export class SshRemoteCommandRunner implements RemoteCommandRunner {
  run(input: RemoteCommandInput): Promise<RemoteCommandResult> {
    const sshHost = normalizeSshHost(input.sshHost);

    return new Promise((resolve) => {
      const child = spawn("ssh", [sshHost, `sh -lc ${shellQuote(input.remoteScript)}`], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        resolve({
          exitCode: 255,
          stdout,
          stderr: `${stderr}${error.message}`
        });
      });
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 255,
          stdout,
          stderr
        });
      });
    });
  }
}

function normalizePid(pid: number): number {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("pid must be a positive integer");
  }

  return pid;
}

function normalizeSshHost(sshHost: string): string {
  const normalized = sshHost.trim();

  if (normalized === "") {
    throw new Error("sshHost is required");
  }

  if (normalized.startsWith("-")) {
    throw new Error("sshHost must not start with '-'");
  }

  return normalized;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
