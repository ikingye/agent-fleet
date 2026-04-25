import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentAdapter, AgentRunResult, AgentStartInput } from "./agentAdapter.js";
import type { CommandRunner } from "./commandRunner.js";

export class CodexAdapter implements AgentAdapter {
  readonly kind = "codex";

  constructor(private runner: CommandRunner) {}

  async detect(): Promise<{ available: boolean; version: string | null; message: string }> {
    const result = await this.runner.run("codex", ["--version"], { cwd: process.cwd() });
    const output = `${result.stdout}${result.stderr}`.trim();

    if (result.exitCode === 0) {
      return {
        available: true,
        version: output || null,
        message: output
      };
    }

    return {
      available: false,
      version: null,
      message: output
    };
  }

  async start(input: AgentStartInput): Promise<AgentRunResult> {
    mkdirSync(dirname(input.logPath), { recursive: true });

    const result = await this.runner.run(
      "codex",
      ["exec", "--sandbox", "danger-full-access", input.prompt],
      { cwd: input.worktreePath }
    );
    const output = `${result.stdout}${result.stderr}`;
    writeFileSync(input.logPath, output);

    return {
      kind: this.kind,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      output,
      logPath: input.logPath
    };
  }
}
