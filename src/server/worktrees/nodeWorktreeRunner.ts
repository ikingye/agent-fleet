import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import type { MaterializeWorktreeCommandResult, MaterializeWorktreeRunner } from "./worktreeManager.js";

export function createNodeWorktreeRunner(cwd: string): MaterializeWorktreeRunner {
  return {
    async pathExists(path) {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async ensureDir(path) {
      await mkdir(path, { recursive: true });
    },
    async run(command, args) {
      return runCommand(command, args, cwd);
    }
  };
}

function runCommand(command: string, args: string[], cwd: string): Promise<MaterializeWorktreeCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}
