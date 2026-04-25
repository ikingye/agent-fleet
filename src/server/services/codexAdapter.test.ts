import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "./commandRunner.js";
import { CodexAdapter } from "./codexAdapter.js";

interface RecordedCall {
  command: string;
  args: string[];
  cwd: string;
}

class RecordingCommandRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];

  async run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
    this.calls.push({ command, args, cwd: options.cwd });

    if (args.includes("--version")) {
      return { exitCode: 0, stdout: "codex-cli 0.125.0\n", stderr: "" };
    }

    return { exitCode: 0, stdout: "done\n", stderr: "" };
  }
}

describe("CodexAdapter", () => {
  it("detects codex and starts a run with logs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-adapter-"));
    const logPath = join(dir, "logs", "codex.log");
    const runner = new RecordingCommandRunner();
    const adapter = new CodexAdapter(runner);

    await expect(adapter.detect()).resolves.toEqual({
      available: true,
      version: "codex-cli 0.125.0",
      message: "codex-cli 0.125.0"
    });

    const result = await adapter.start({
      taskId: "task-1",
      prompt: "Implement a small change",
      worktreePath: dir,
      logPath
    });

    expect(result).toEqual({
      kind: "codex",
      status: "succeeded",
      output: "done\n",
      logPath
    });
    expect(runner.calls.at(-1)).toEqual({
      command: "codex",
      args: ["exec", "--sandbox", "danger-full-access", "Implement a small change"],
      cwd: dir
    });
    expect(`${dir}$ codex ${runner.calls.at(-1)?.args.join(" ")}`).toBe(
      `${dir}$ codex exec --sandbox danger-full-access Implement a small change`
    );
    expect(readFileSync(logPath, "utf8")).toContain("done");
  });
});
