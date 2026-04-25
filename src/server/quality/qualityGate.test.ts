import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../services/commandRunner.js";
import { QualityGate } from "./qualityGate.js";

class MockCommandRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  async run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
    this.calls.push({ command, args, cwd: options.cwd });

    if (args.at(-1) === "npm run typecheck") {
      return { exitCode: 0, stdout: "typecheck ok\n", stderr: "" };
    }

    return { exitCode: 1, stdout: "test output\n", stderr: "test failed\n" };
  }
}

describe("QualityGate", () => {
  it("runs configured commands and fails when any command fails", async () => {
    const runner = new MockCommandRunner();
    const gate = new QualityGate(runner);

    const result = await gate.run({
      taskId: "task-1",
      repositoryRoot: "/repo",
      commands: [
        { name: "Typecheck", command: "npm run typecheck" },
        { name: "Tests", command: "npm run test" }
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.checks.map((check) => check.status)).toEqual(["passed", "failed"]);
    expect(result.checks.map((check) => check.output)).toEqual([
      "typecheck ok\n",
      "test output\ntest failed\n"
    ]);
    expect(runner.calls).toEqual([
      { command: "sh", args: ["-lc", "npm run typecheck"], cwd: "/repo" },
      { command: "sh", args: ["-lc", "npm run test"], cwd: "/repo" }
    ]);
  });
});
