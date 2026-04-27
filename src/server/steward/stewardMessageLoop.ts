import type { ConversationTransport, DashboardData, Goal, StewardMessage, WorkerSession } from "../../shared/types.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import type { StewardRuntime } from "./stewardRuntime.js";

export interface StewardOwnerMessageInput {
  conversationId?: string | null;
  transport?: ConversationTransport | null;
  externalMessageId?: string | null;
  idempotencyKey?: string | null;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
  body: string;
}

export interface StewardOwnerMessageResult {
  ownerMessage: StewardMessage;
  stewardMessage: StewardMessage;
}

interface StewardMessageLoopOptions {
  store: JsonControlPlaneStore;
  steward: StewardRuntime;
}

const activeGoalStatuses = new Set(["queued", "running", "blocked"]);
const activeWorkerStatuses = new Set(["starting", "running", "paused"]);

interface StewardMessageContext {
  conversationId: string | null;
  transport: ConversationTransport | null;
}

export class StewardMessageLoop {
  constructor(private readonly options: StewardMessageLoopOptions) {}

  async acceptOwnerMessage(input: StewardOwnerMessageInput): Promise<StewardOwnerMessageResult> {
    const dashboard = await this.options.store.dashboard();
    const goal = input.goalId === null ? null : findGoal(dashboard, input.goalId);
    const projectName = goal?.projectName ?? input.projectName;
    const workspacePath = goal?.workspacePath ?? input.workspacePath;
    const context = {
      conversationId: input.conversationId ?? null,
      transport: input.transport ?? null
    };
    const ownerMessage = await this.options.store.recordStewardMessage({
      role: "owner",
      ...context,
      externalMessageId: input.externalMessageId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      projectName,
      workspacePath,
      goalId: input.goalId,
      body: input.body
    });

    if (goal !== null) {
      return {
        ownerMessage,
        stewardMessage: await this.recordGoalUpdateResponse(goal, projectName, workspacePath, input.body, context)
      };
    }

    if (isStatusOrRecoveryMessage(input.body) || !isActionableMessage(input.body)) {
      return {
        ownerMessage,
        stewardMessage: await this.recordStatusResponse(projectName, workspacePath, null, context)
      };
    }

    if (projectName === null || workspacePath === null) {
      const stewardMessage = await this.options.store.recordStewardMessage({
        role: "steward",
        ...context,
        projectName,
        workspacePath,
        goalId: null,
        body: "I recorded the request, but I need both projectName and workspacePath before dispatching a Worker Agent."
      });

      return { ownerMessage, stewardMessage };
    }

    const goalTitle = deriveGoalTitle(input.body);
    const createdGoal = await this.options.steward.acceptGoal({
      projectName,
      workspacePath,
      title: goalTitle,
      body: input.body
    });
    const stewardMessage = await this.options.store.recordStewardMessage({
      role: "steward",
      ...context,
      projectName,
      workspacePath,
      goalId: createdGoal.id,
      body: await this.buildCreatedGoalResponse(createdGoal)
    });

    return { ownerMessage, stewardMessage };
  }

  private async recordGoalUpdateResponse(
    goal: Goal,
    projectName: string | null,
    workspacePath: string | null,
    body: string,
    context: StewardMessageContext
  ): Promise<StewardMessage> {
    const dashboard = await this.options.store.dashboard();
    const activeSessions = activeWorkerSessionsForGoal(dashboard, goal.id);
    const primarySession = activeSessions[0] ?? null;
    const decision = await this.options.store.recordDecision({
      goalId: goal.id,
      workerSessionId: primarySession?.id ?? null,
      title: "Record owner update for active goal",
      rationale: `The owner updated goal ${goal.id}: ${body}`,
      risk: "low",
      confidence: 0.86,
      reversible: true,
      needsHumanReview: false,
      status: "active",
      actions: [
        "Record the owner update as Steward decision context",
        primarySession === null
          ? "No active Worker Agent exists for this goal; review before dispatching again"
          : `Active Worker already exists: ${primarySession.id}`,
        "Do not spawn a duplicate Worker Agent for the same active goal"
      ]
    });
    const checkpoint = await this.options.store.recordStewardCheckpoint({
      reason: "correction",
      summary: `Owner update recorded for goal: ${goal.title}`,
      nextAction:
        primarySession === null
          ? "Review this goal before dispatching another Worker Agent; no active Worker exists."
          : `Active Worker already exists (${primarySession.id}); use this owner update when reviewing Worker results.`,
      goalIds: [goal.id],
      workerSessionIds: primarySession === null ? [] : [primarySession.id]
    });
    const activeWorkerSentence =
      primarySession === null
        ? "No active Worker exists; no duplicate Worker was dispatched automatically."
        : `Active Worker already exists (${primarySession.id}); no duplicate Worker dispatched.`;

    return this.options.store.recordStewardMessage({
      role: "steward",
      ...context,
      projectName,
      workspacePath,
      goalId: goal.id,
      body: `Owner update recorded for goal ${goal.id}: ${goal.title}. ${activeWorkerSentence} Decision ${decision.id} and checkpoint ${checkpoint.id} recorded.`
    });
  }

  private async recordStatusResponse(
    projectName: string | null,
    workspacePath: string | null,
    goalId: string | null,
    context: StewardMessageContext
  ): Promise<StewardMessage> {
    const dashboard = await this.options.store.dashboard();

    return this.options.store.recordStewardMessage({
      role: "steward",
      ...context,
      projectName,
      workspacePath,
      goalId,
      body: buildStatusResponse(dashboard, projectName, workspacePath)
    });
  }

  private async buildCreatedGoalResponse(goal: Goal): Promise<string> {
    const dashboard = await this.options.store.dashboard();
    const sessions = dashboard.workerSessions.filter((session) => session.goalId === goal.id);
    const activeSession = sessions.find((session) => activeWorkerStatuses.has(session.status));
    const failedSession = sessions.find((session) => session.status === "failed");

    if (goal.status === "blocked" || failedSession !== undefined) {
      return `Created goal ${goal.id}: ${goal.title} (${goal.status}). Worker blocked; review the latest Steward checkpoint for the dispatch blocker.`;
    }

    if (activeSession !== undefined) {
      return `Created goal ${goal.id}: ${goal.title} (${goal.status}). Worker dispatched as session ${activeSession.id}.`;
    }

    return `Created goal ${goal.id}: ${goal.title} (${goal.status}). Worker dispatch recorded; check dashboard state for the current session.`;
  }
}

function findGoal(dashboard: DashboardData, goalId: string): Goal {
  const goal = dashboard.goals.find((item) => item.id === goalId);

  if (goal === undefined) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  return goal;
}

function activeWorkerSessionsForGoal(dashboard: DashboardData, goalId: string): WorkerSession[] {
  return dashboard.workerSessions.filter(
    (session) => session.goalId === goalId && activeWorkerStatuses.has(session.status)
  );
}

function buildStatusResponse(
  dashboard: DashboardData,
  projectName: string | null,
  workspacePath: string | null
): string {
  const activeGoals = dashboard.goals.filter((goal) => {
    if (!activeGoalStatuses.has(goal.status)) {
      return false;
    }

    if (projectName !== null && goal.projectName !== projectName) {
      return false;
    }

    if (workspacePath !== null && goal.workspacePath !== workspacePath) {
      return false;
    }

    return true;
  });
  const latestCheckpoint = [...dashboard.stewardCheckpoints].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
  )[0];
  const pieces = [
    workspacePath === null ? "No workspace is selected for this chat." : `Workspace: ${workspacePath}.`,
    `I see ${activeGoals.length} active ${activeGoals.length === 1 ? "goal" : "goals"}${
      projectName === null ? "" : ` for ${projectName}`
    }.`
  ];

  if (activeGoals.length > 0) {
    pieces.push(`Current active goal: ${activeGoals[0].title} (${activeGoals[0].status}).`);
  }

  if (latestCheckpoint !== undefined) {
    pieces.push(`Recovery next action: ${latestCheckpoint.nextAction}`);
  } else {
    pieces.push("Recovery next action: no checkpoint yet; use dashboard state before dispatching more Worker Agents.");
  }

  return pieces.join(" ");
}

function isStatusOrRecoveryMessage(body: string): boolean {
  const normalized = body.toLowerCase();

  if (/\b(where are we|current state)\b/.test(normalized)) {
    return true;
  }

  if (/^(what|where|how|show|list|summarize|summarise|give me|tell me)\b/.test(normalized)) {
    return /\b(status|recovery|recover|progress|state|checkpoint|goal|worker)\b/.test(normalized);
  }

  return (
    /\b(current|latest)\s+(status|recovery|progress|checkpoint)\b/.test(normalized) ||
    /\b(recovery|status)\s+(state|report)\b/.test(normalized)
  );
}

function isActionableMessage(body: string): boolean {
  return /\b(build|implement|fix|create|add|update|change|investigate|debug|refactor|run|test|verify|prepare|ship|write|review)\b/i.test(
    body
  );
}

function deriveGoalTitle(body: string): string {
  const cleaned = body
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[,.;:!?]+|[,.;:!?]+$/g, "")
    .replace(/^(please|can you|could you|would you)\s+/i, "");
  const firstSentence = cleaned.split(/[.!?]\s+/)[0] ?? cleaned;
  const withoutVerificationTail = firstSentence.replace(/\s+and\s+(verify|test|run|ensure|make sure)\b.*$/i, "");
  const withoutWorkspaceTail = withoutVerificationTail.replace(
    /\s+for\s+the\s+[\w -]+?\s+(app|project|repo|repository|workspace|codebase)$/i,
    ""
  );
  const words = withoutWorkspaceTail.split(" ").filter((word) => word.trim() !== "");
  const concise = words.slice(0, 8).join(" ") || "Owner request";

  return concise.charAt(0).toUpperCase() + concise.slice(1);
}
