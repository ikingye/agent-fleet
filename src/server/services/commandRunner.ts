import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv }
  ): Promise<CommandResult>;
}

export function createCommandRunner(): CommandRunner {
  return {
    run(command, args, options) {
      return new Promise<CommandResult>((resolve) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          shell: false
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve({ exitCode: 127, stdout, stderr: stderr + error.message });
        });
        child.on("close", (code) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });
      });
    }
  };
}
