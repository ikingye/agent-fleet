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
import { buildResumeCommand } from "../workers/resumeCommand.js";

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
  workspacePath: string;
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
    const repositoryPath = input.workspacePath;
    const worktreeRoot = this.options.worktreeRoot ?? join(repositoryPath, ".worktrees");
    let plannedWorktree: PlannedWorktree | null = null;
    let workerCwd = input.workspacePath;

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

    const updatedGoal = await this.options.store.updateGoalStatus(goal.id, goalStatusForWorkerStatus(workerResult.status));
    await this.options.store.recordStewardCheckpoint({
      reason: "dispatch",
      summary: `Worker session ${session.id} recorded for goal: ${goal.title}`,
      nextAction: buildDispatchNextAction(
        session.id,
        session.kind,
        workerResult.command,
        workerResult.resumeId,
        workerResult.status,
        workerResult.initialOutput
      ),
      goalIds: [goal.id],
      workerSessionIds: [session.id]
    });

    return updatedGoal;
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
      await this.options.store.recordStewardCheckpoint({
        reason: "correction",
        summary: "Human correction recorded for Steward decision.",
        nextAction: "Use the correction in future Worker instructions and recovery summaries.",
        goalIds: [correctedDecision.goalId],
        workerSessionIds: correctedDecision.workerSessionId === null ? [] : [correctedDecision.workerSessionId]
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

function buildDispatchNextAction(
  workerSessionId: string,
  kind: WorkerAdapter["kind"],
  command: string,
  resumeId: string | null,
  status: "running" | "completed" | "failed",
  initialOutput: string
): string {
  if (status === "failed") {
    const output = summarizeWorkerOutput(initialOutput);

    if (output === "") {
      return `Review failed Worker session ${workerSessionId}; ${command} did not start.`;
    }

    return `Review failed Worker session ${workerSessionId}; ${output}`;
  }

  const resumeCommand = buildResumeCommand({
    kind,
    baseCommand: command,
    resumeId
  });

  if (resumeCommand === null) {
    return `Monitor Worker session ${workerSessionId}; no resume id is available yet, so recover from durable state if the Steward session is interrupted.`;
  }

  return `Monitor Worker session ${workerSessionId}; resume with ${resumeCommand} if the Steward session is interrupted.`;
}

function summarizeWorkerOutput(output: string): string {
  const oneLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");

  return oneLine.length > 240 ? `${oneLine.slice(0, 237)}...` : oneLine;
}
