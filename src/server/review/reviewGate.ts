import { join } from "node:path";
import { CodexAdapter } from "../services/codexAdapter.js";
import { createCommandRunner } from "../services/commandRunner.js";
import type { AgentAdapter } from "../services/agentAdapter.js";

export interface ReviewGateInput {
  taskId: string;
  worktreePath: string;
  goal: string;
  logRoot: string;
}

export interface ReviewGateResult {
  passed: boolean;
  summary: string;
}

export class ReviewGate {
  constructor(private reviewer: AgentAdapter = new CodexAdapter(createCommandRunner())) {}

  async run(input: ReviewGateInput): Promise<ReviewGateResult> {
    const result = await this.reviewer.start({
      taskId: input.taskId,
      prompt: this.buildPrompt(input),
      worktreePath: input.worktreePath,
      logPath: join(input.logRoot, `${input.taskId}-review.log`)
    });
    const summary = result.output.trim();

    return {
      passed: result.status === "succeeded" && summary.startsWith("APPROVED"),
      summary
    };
  }

  private buildPrompt(input: ReviewGateInput): string {
    return [
      "Review the task changes for defects, regressions, missing tests, and risky behavior.",
      "Put APPROVED on the first line only if the work is ready to merge.",
      "Put CHANGES_REQUESTED on the first line if fixes are required.",
      "",
      "Goal:",
      input.goal
    ].join("\n");
  }
}
