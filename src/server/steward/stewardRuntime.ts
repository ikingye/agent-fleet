import { join } from "node:path";
import type { Goal, DecisionCorrection } from "../../shared/types.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import {
  materializeWorktree,
  planWorktree,
  type MaterializeWorktreeRunner,
  type PlannedWorktree
} from "../worktrees/worktreeManager.js";
import type { WorkerAdapter } from "../workers/commandWorkerAdapter.js";

export interface StewardRuntimeOptions {
  store: JsonControlPlaneStore;
  workerAdapter: WorkerAdapter;
  defaultWorkerCwd: string;
  defaultRepositoryPath?: string;
  worktreeRoot?: string;
  worktreeRunner?: MaterializeWorktreeRunner;
}

export interface AcceptGoalInput {
  projectName: string;
  title: string;
  body: string;
}

export interface CorrectDecisionInput {
  decisionId: string;
  body: string;
}

export class StewardRuntime {
  constructor(private readonly options: StewardRuntimeOptions) {}

  async acceptGoal(input: AcceptGoalInput): Promise<Goal> {
    const goal = await this.options.store.createGoal(input);
    const decision = await this.options.store.recordDecision({
      goalId: goal.id,
      workerSessionId: null,
      title: "Start Worker Agent for goal",
      rationale: "The goal is actionable and reversible enough for the Steward Agent to begin autonomous execution.",
      risk: "medium",
      confidence: 0.72,
      reversible: true,
      needsHumanReview: true,
      status: "active",
      actions: [
        "Create an auditable Steward decision",
        "Start a Worker Agent session",
        "Track resume metadata for recovery"
      ]
    });
    const repositoryPath = this.options.defaultRepositoryPath ?? process.cwd();
    const worktreeRoot = this.options.worktreeRoot ?? join(repositoryPath, ".worktrees");
    let plannedWorktree: PlannedWorktree | null = null;
    let workerCwd = this.options.defaultWorkerCwd;

    if (this.options.worktreeRunner !== undefined) {
      plannedWorktree = planWorktree({
        projectName: goal.projectName,
        repositoryPath,
        worktreeRoot,
        goalTitle: goal.title,
        workerSessionId: decision.id
      });
      await materializeWorktree(plannedWorktree, this.options.worktreeRunner);
      workerCwd = plannedWorktree.path;
    }

    const workerResult = await this.options.workerAdapter.start({
      goalTitle: goal.title,
      cwd: workerCwd,
      prompt: this.buildWorkerPrompt(goal.title, goal.body)
    });
    const session = await this.options.store.createWorkerSession({
      goalId: goal.id,
      decisionId: decision.id,
      kind: this.options.workerAdapter.kind,
      command: workerResult.command,
      cwd: workerResult.cwd,
      pid: workerResult.pid,
      hostId: null,
      resumeId: workerResult.resumeId,
      status: workerResult.status,
      lastOutput: workerResult.initialOutput
    });

    plannedWorktree ??= planWorktree({
      projectName: goal.projectName,
      repositoryPath,
      worktreeRoot,
      goalTitle: goal.title,
      workerSessionId: session.id
    });
    await this.options.store.createWorktreeAssignment({
      workerSessionId: session.id,
      repositoryPath,
      worktreePath: plannedWorktree.path,
      branchName: plannedWorktree.branchName
    });

    await this.options.store.linkDecisionToWorkerSession(decision.id, session.id);

    return this.options.store.updateGoalStatus(goal.id, goalStatusForWorkerStatus(workerResult.status));
  }

  async correctDecision(input: CorrectDecisionInput): Promise<DecisionCorrection> {
    const correction = await this.options.store.addCorrection({
      decisionId: input.decisionId,
      body: input.body,
      createdBy: "human"
    });

    await this.options.store.upsertMemory({
      scope: "user",
      projectName: null,
      key: "correction:terminology",
      value: input.body,
      sourceCorrectionId: correction.id
    });

    const dashboard = await this.options.store.dashboard();
    const correctedDecision = dashboard.decisions.find((decision) => decision.id === input.decisionId);

    if (correctedDecision !== undefined) {
      await this.options.store.recordDecision({
        goalId: correctedDecision.goalId,
        workerSessionId: correctedDecision.workerSessionId,
        title: "Apply human correction",
        rationale: `The human corrected a Steward decision: ${input.body}`,
        risk: "low",
        confidence: 0.9,
        reversible: true,
        needsHumanReview: false,
        status: "active",
        actions: ["Update memory", "Use the correction in future Worker instructions"]
      });
    }

    return correction;
  }

  private buildWorkerPrompt(title: string, body: string): string {
    return [
      "You are a Worker Agent operating under the Steward Agent.",
      "Treat Steward instructions as the human owner's instructions.",
      "",
      `Goal: ${title}`,
      "",
      body,
      "",
      "Report blockers, resume ids, test results, and important decisions back to the Steward Agent."
    ].join("\n");
  }
}

function goalStatusForWorkerStatus(status: "running" | "completed" | "failed") {
  if (status === "running") {
    return "running";
  }

  return status === "completed" ? "completed" : "blocked";
}
