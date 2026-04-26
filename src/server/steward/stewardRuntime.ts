import { join, posix } from "node:path";
import type { Goal, DecisionCorrection, ExecutionNode } from "../../shared/types.js";
import { evaluateRemoteNodeReadiness } from "../remote/remoteNodeReadiness.js";
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
  remoteWorkerAdapterFactory?: (node: ExecutionNode) => WorkerAdapter;
  defaultWorkerCwd: string;
  defaultRepositoryPath?: string;
  worktreeRoot?: string;
  worktreeRunner?: MaterializeWorktreeRunner;
}

interface WorkerPlacement {
  adapter: WorkerAdapter;
  hostId: string | null;
  cwd: string;
  worktreePath: string;
  workerName: string;
  resourceTags: string[];
  remoteNodeName: string | null;
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
    const repositoryPath = input.workspacePath;
    const worktreeRoot = this.options.worktreeRoot ?? join(repositoryPath, ".worktrees");
    let plannedWorktree: PlannedWorktree | null = null;
    const placement = await this.selectWorkerPlacement(goal, input.workspacePath);
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
        `Worker Name: ${placement.workerName}`,
        ...buildPlacementActions(placement),
        "Start a Worker Agent session",
        "Track resume metadata for recovery"
      ]
    });
    let workerCwd = placement.cwd;

    if (placement.hostId === null && this.options.worktreeRunner !== undefined) {
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

    const workerResult = await placement.adapter.start({
      goalTitle: goal.title,
      cwd: workerCwd,
      prompt: this.buildWorkerPrompt(placement.workerName, goal.title, goal.body)
    });
    const session = await this.options.store.createWorkerSession({
      goalId: goal.id,
      decisionId: decision.id,
      kind: placement.adapter.kind,
      command: workerResult.command,
      cwd: workerResult.cwd,
      pid: workerResult.pid,
      hostId: placement.hostId,
      resumeId: workerResult.resumeId,
      status: workerResult.status,
      lastOutput: workerResult.initialOutput
    });
    this.attachWorkerCompletionHandler({
      completion: workerResult.completion,
      goalId: goal.id,
      goalTitle: goal.title,
      workerSessionId: session.id
    });

    const worktreeAssignment =
      plannedWorktree ??
      (placement.hostId === null
        ? planWorktree({
            projectName: goal.projectName,
            repositoryPath,
            worktreeRoot,
            goalTitle: goal.title,
            workerSessionId: session.id
          })
        : {
            path: placement.worktreePath,
            branchName: `remote/${session.id}-${slugify(goal.title)}`
          });
    await this.options.store.createWorktreeAssignment({
      workerSessionId: session.id,
      repositoryPath,
      worktreePath: worktreeAssignment.path,
      branchName: worktreeAssignment.branchName
    });

    await this.options.store.linkDecisionToWorkerSession(decision.id, session.id);

    const updatedGoal = await this.options.store.updateGoalStatus(goal.id, goalStatusForWorkerStatus(workerResult.status));
    await this.options.store.recordStewardCheckpoint({
      reason: "dispatch",
      summary: `Worker ${placement.workerName} recorded as session ${session.id} for goal: ${goal.title}`,
      nextAction: buildDispatchNextAction(
        session.id,
        placement.workerName,
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

  private async selectWorkerPlacement(goal: Goal, workspacePath: string): Promise<WorkerPlacement> {
    const resourceTags = detectGoalResourceTags(goal);
    const remoteNode = resourceTags.length === 0 ? null : await this.selectReadyRemoteNode(resourceTags);

    if (remoteNode !== null && this.options.remoteWorkerAdapterFactory !== undefined) {
      const remoteWorkspacePath = buildRemoteWorkspacePath(remoteNode, goal.projectName, workspacePath);

      return {
        adapter: this.options.remoteWorkerAdapterFactory(remoteNode),
        hostId: remoteNode.id,
        cwd: remoteWorkspacePath,
        worktreePath: remoteWorkspacePath,
        workerName: buildWorkerName(goal, true),
        resourceTags,
        remoteNodeName: remoteNode.name
      };
    }

    return {
      adapter: this.options.workerAdapter,
      hostId: null,
      cwd: workspacePath,
      worktreePath: workspacePath,
      workerName: buildWorkerName(goal, false),
      resourceTags,
      remoteNodeName: null
    };
  }

  private async selectReadyRemoteNode(requiredTags: string[]): Promise<ExecutionNode | null> {
    const dashboard = await this.options.store.dashboard();
    const runningByHostId = new Map<string, number>();

    for (const session of dashboard.workerSessions) {
      if (session.hostId === null || (session.status !== "starting" && session.status !== "running")) {
        continue;
      }

      runningByHostId.set(session.hostId, (runningByHostId.get(session.hostId) ?? 0) + 1);
    }

    const candidates = dashboard.executionNodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => {
        if (node.kind !== "remote") {
          return false;
        }

        return evaluateRemoteNodeReadiness({
          status: node.status,
          sshHost: node.sshHost,
          workRoot: node.workRoot,
          proxyUrl: node.proxyUrl,
          proxyRequired: false
        }).ready;
      })
      .map(({ node, index }) => {
        const capacity = Math.max(1, Math.floor(node.capacity));
        const running = runningByHostId.get(node.id) ?? 0;
        const availableSlots = capacity - running;
        const tagSet = new Set(node.tags.map((tag) => tag.toLowerCase()));
        const matchedRequiredTags = requiredTags.filter((tag) => tagSet.has(tag)).length;

        return { node, index, availableSlots, matchedRequiredTags };
      })
      .filter((candidate) => candidate.availableSlots > 0 && candidate.matchedRequiredTags === requiredTags.length);

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftMatchesAll = left.matchedRequiredTags === requiredTags.length ? 1 : 0;
      const rightMatchesAll = right.matchedRequiredTags === requiredTags.length ? 1 : 0;

      return (
        rightMatchesAll - leftMatchesAll ||
        right.matchedRequiredTags - left.matchedRequiredTags ||
        right.availableSlots - left.availableSlots ||
        left.index - right.index
      );
    });

    return candidates[0].node;
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

  private buildWorkerPrompt(workerName: string, title: string, body: string): string {
    return [
      `Worker Name: ${workerName}`,
      "",
      "You are a Worker Agent operating under the Steward Agent.",
      "Treat Steward instructions as the human owner's instructions.",
      "Use the exact Worker Name as the heading of your final report.",
      "",
      `Goal: ${title}`,
      "",
      body,
      "",
      "Report blockers, resume ids, test results, and important decisions back to the Steward Agent."
    ].join("\n");
  }

  private attachWorkerCompletionHandler(input: {
    completion: Awaited<ReturnType<WorkerAdapter["start"]>>["completion"];
    goalId: string;
    goalTitle: string;
    workerSessionId: string;
  }): void {
    if (input.completion === undefined) {
      return;
    }

    void input.completion
      .then(async (completion) => {
        await this.options.store.updateWorkerSessionStatus({
          workerSessionId: input.workerSessionId,
          status: completion.status,
          lastOutput: completion.output
        });
        await this.options.store.updateGoalStatus(input.goalId, goalStatusForWorkerStatus(completion.status));
        await this.options.store.recordStewardCheckpoint({
          reason: "recovery",
          summary: `Worker session ${input.workerSessionId} ${completion.status} for goal: ${input.goalTitle}`,
          nextAction: buildCompletionNextAction(input.workerSessionId, completion.status, completion.output),
          goalIds: [input.goalId],
          workerSessionIds: [input.workerSessionId]
        });
      })
      .catch((error: unknown) => {
        console.error("Worker completion handler failed", error);
      });
  }
}

function buildRemoteWorkspacePath(node: ExecutionNode, projectName: string, workspacePath: string): string {
  return posix.join(node.workRoot, slugify(projectName), slugify(workspaceName(workspacePath)));
}

function detectGoalResourceTags(goal: Goal): string[] {
  const text = `${goal.title}\n${goal.body}`.toLowerCase();
  const tags = new Set<string>();

  if (/(gpu|cuda|训练|模型|推理|渲染)/i.test(text)) {
    tags.add("gpu");
  }

  if (/(long-running|overnight|持续|长时间|跑一晚|高cpu|cpu|heavy|high-load|高负载|并行|批量|build|test)/i.test(text)) {
    tags.add("high-cpu");
  }

  return [...tags];
}

function buildPlacementActions(placement: WorkerPlacement): string[] {
  if (placement.hostId !== null) {
    return [
      `Dispatch to remote execution node ${placement.remoteNodeName ?? placement.hostId} for ${placement.resourceTags.join(", ")} work`
    ];
  }

  if (placement.resourceTags.length > 0) {
    return ["Use local Worker fallback; no ready remote capacity is available."];
  }

  return ["Use local Worker adapter; goal does not require remote offload."];
}

function buildWorkerName(goal: Goal, remote: boolean): string {
  const timestamp = formatWorkerTimestamp(new Date());
  const remoteMarker = remote ? "-remote" : "";

  return `${slugify(goal.projectName)}-${slugify(goal.title)}${remoteMarker}-${timestamp}`;
}

function formatWorkerTimestamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ];
  const [year, month, day, hour, minute] = parts.map((part, index) =>
    index === 0 ? String(part) : String(part).padStart(2, "0")
  );

  return `${year}${month}${day}${hour}${minute}`;
}

function workspaceName(workspacePath: string): string {
  const normalized = workspacePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  const segments = normalized.split("/").filter((segment) => segment.trim() !== "");

  return segments.at(-1) ?? "workspace";
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, "-")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug === "" ? "workspace" : slug;
}

function goalStatusForWorkerStatus(status: "running" | "completed" | "failed") {
  if (status === "running") {
    return "running";
  }

  return status === "completed" ? "completed" : "blocked";
}

function buildDispatchNextAction(
  workerSessionId: string,
  workerName: string,
  kind: WorkerAdapter["kind"],
  command: string,
  resumeId: string | null,
  status: "running" | "completed" | "failed",
  initialOutput: string
): string {
  if (status === "failed") {
    const output = summarizeWorkerOutput(initialOutput);

    if (output === "") {
      return `Review failed Worker session ${workerSessionId} (${workerName}); ${command} did not start.`;
    }

    return `Review failed Worker session ${workerSessionId} (${workerName}); ${output}`;
  }

  const resumeCommand = buildResumeCommand({
    kind,
    baseCommand: command,
    resumeId
  });

  if (resumeCommand === null) {
    return `Monitor Worker session ${workerSessionId}; no resume id is available yet, so recover from durable state if the Steward session is interrupted. Worker Name: ${workerName}.`;
  }

  return `Monitor Worker session ${workerSessionId}; resume with ${resumeCommand} if the Steward session is interrupted. Worker Name: ${workerName}.`;
}

function summarizeWorkerOutput(output: string): string {
  const oneLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");

  return oneLine.length > 240 ? `${oneLine.slice(0, 237)}...` : oneLine;
}

function buildCompletionNextAction(
  workerSessionId: string,
  status: "completed" | "failed",
  output: string
): string {
  const summary = summarizeWorkerOutput(output);

  if (status === "completed") {
    return summary === ""
      ? `Review completed Worker session ${workerSessionId} and decide the next owner-facing step.`
      : `Review completed Worker session ${workerSessionId}: ${summary}`;
  }

  return summary === ""
    ? `Review failed Worker session ${workerSessionId} and decide whether to resume, correct, or ask the owner.`
    : `Review failed Worker session ${workerSessionId}: ${summary}`;
}
