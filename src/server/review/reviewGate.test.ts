import { describe, expect, it } from "vitest";
import type { AgentRunResult, AgentAdapter } from "../services/agentAdapter.js";
import { ReviewGate } from "./reviewGate.js";

class MockAgentAdapter implements AgentAdapter {
  readonly kind = "codex";
  call: { taskId: string; prompt: string; worktreePath: string; logPath: string } | null = null;

  async detect(): Promise<{ available: boolean; version: string | null; message: string }> {
    return { available: true, version: "codex-cli 0.125.0", message: "codex-cli 0.125.0" };
  }

  async start(input: {
    taskId: string;
    prompt: string;
    worktreePath: string;
    logPath: string;
  }): Promise<AgentRunResult> {
    this.call = input;

    return {
      kind: "codex",
      status: "succeeded",
      output: "APPROVED\nReviewed task-1",
      logPath: input.logPath
    };
  }
}

describe("ReviewGate", () => {
  it("passes when the Codex review approves the changes", async () => {
    const reviewer = new MockAgentAdapter();
    const gate = new ReviewGate(reviewer);

    const result = await gate.run({
      taskId: "task-1",
      worktreePath: "/repo/.worktrees/task-1",
      goal: "Add API health",
      logRoot: "/repo/.logs"
    });

    expect(result.passed).toBe(true);
    expect(result.summary).toContain("APPROVED");
    expect(reviewer.call).toEqual({
      taskId: "task-1",
      prompt: expect.stringContaining("Goal:\nAdd API health"),
      worktreePath: "/repo/.worktrees/task-1",
      logPath: "/repo/.logs/task-1-review.log"
    });
  });
});
