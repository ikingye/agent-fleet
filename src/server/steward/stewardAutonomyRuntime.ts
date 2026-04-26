import type { StewardCheckpoint, StewardDecision, WorkerReport, WorkerSession } from "../../shared/types.js";
import type { RemoteGithubDeployKeyProvisioner } from "../remote/remoteKeyProvisioner.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { buildStewardRecoveryReport } from "./recoveryRuntime.js";
import { buildMemoryContext } from "./memoryContext.js";
import { reconcileWorkerSessions, type SupervisorReconcileInput } from "./supervisorRuntime.js";
import { maintainGithubDeployKeyLeases } from "./githubDeployKeyLeaseMaintenance.js";

export interface StewardAutonomyTickResult {
  checked: number;
  updated: number;
  decisionsRecorded: number;
  handoffsQueued: number;
  ownerReviewNeeded: number;
}

export interface StewardAutonomyTickOutput {
  result: StewardAutonomyTickResult;
  checkpoint: StewardCheckpoint;
}

export interface RunStewardAutonomyTickInput {
  store: JsonControlPlaneStore;
  probeProcess: SupervisorReconcileInput["probeProcess"];
  githubDeployKeyLeaseTtlMs?: number;
  remoteGithubDeployKeyProvisioner?: Pick<RemoteGithubDeployKeyProvisioner, "cleanupRemoteKey">;
}

interface QueuedAction {
  goalId: string;
  workerSessionId: string;
  nextAction: string;
  memorySummary: string | null;
  handoffQueued: boolean;
  ownerReviewNeeded: boolean;
}

export async function runStewardAutonomyTick(input: RunStewardAutonomyTickInput): Promise<StewardAutonomyTickOutput> {
  const initialDashboard = await input.store.dashboard();
  const supervisedSessions = initialDashboard.workerSessions.filter(
    (session) => session.status === "starting" || session.status === "running"
  );
  const reconcileResult = await reconcileWorkerSessions({
    dashboard: initialDashboard,
    probeProcess: input.probeProcess,
    updateWorkerSessionStatus(update) {
      return input.store.updateWorkerSessionStatus(update);
    },
    updateGoalStatus(goalId, status) {
      return input.store.updateGoalStatus(goalId, status);
    }
  });
  await maintainGithubDeployKeyLeases({
    store: input.store,
    leaseTtlMs: input.githubDeployKeyLeaseTtlMs,
    remoteGithubDeployKeyProvisioner: input.remoteGithubDeployKeyProvisioner
  });

  const reconciledDashboard = await input.store.dashboard();
  const queuedActions: QueuedAction[] = [];
  let decisionsRecorded = 0;
  let handoffsQueued = 0;
  let ownerReviewNeeded = 0;

  for (const report of reconciledDashboard.workerReports ?? []) {
    if (hasDecisionAction(reconciledDashboard.decisions, `Worker report: ${report.id}`)) {
      continue;
    }

    const goal = reconciledDashboard.goals.find((item) => item.id === report.goalId);
    const session = reconciledDashboard.workerSessions.find((item) => item.id === report.workerSessionId);

    if (goal === undefined || session === undefined) {
      continue;
    }

    const memory = buildMemoryContext({ goal, memories: reconciledDashboard.memories });
    const needsOwnerReview = report.status !== "DONE" || report.needsOwnerReview || report.blockers.length > 0;
    const handoffQueued = !needsOwnerReview;
    const nextAction = buildReportNextAction(report, needsOwnerReview);

    await input.store.recordDecision({
      goalId: goal.id,
      workerSessionId: session.id,
      title: needsOwnerReview ? "Request owner review for Worker report" : "Queue review and merge handoff",
      rationale: [
        `Worker report ${report.id} completed with status ${report.status}.`,
        needsOwnerReview
          ? "The Steward needs owner-visible review before continuing."
          : "The Worker finished with verification, so the next deterministic step is review and merge handoff.",
        memory.summary
      ]
        .filter((line): line is string => line !== null)
        .join(" "),
      risk: needsOwnerReview ? "high" : "medium",
      confidence: needsOwnerReview ? 0.68 : 0.76,
      reversible: true,
      needsHumanReview: needsOwnerReview,
      status: "active",
      actions: [
        `Worker report: ${report.id}`,
        `Worker session: ${session.id}`,
        nextAction,
        ...report.verification.map((item) => `Verification: ${item}`),
        ...report.blockers.map((item) => `Blocker: ${item}`),
        ...(memory.summary === null ? [] : [`Memory applied: ${memory.summary}`])
      ]
    });

    decisionsRecorded += 1;
    handoffsQueued += handoffQueued ? 1 : 0;
    ownerReviewNeeded += needsOwnerReview ? 1 : 0;
    queuedActions.push({
      goalId: goal.id,
      workerSessionId: session.id,
      nextAction,
      memorySummary: memory.summary,
      handoffQueued,
      ownerReviewNeeded: needsOwnerReview
    });
  }

  for (const session of reconciledDashboard.workerSessions) {
    if (session.status !== "failed") {
      continue;
    }

    if ((reconciledDashboard.workerReports ?? []).some((report) => report.workerSessionId === session.id)) {
      continue;
    }

    if (hasDecisionAction(reconciledDashboard.decisions, `Worker session: ${session.id}`)) {
      continue;
    }

    const goal = reconciledDashboard.goals.find((item) => item.id === session.goalId);

    if (goal === undefined) {
      continue;
    }

    const memory = buildMemoryContext({ goal, memories: reconciledDashboard.memories });
    const nextAction = buildFailedSessionNextAction(session);

    await input.store.recordDecision({
      goalId: goal.id,
      workerSessionId: session.id,
      title: "Request owner review for failed Worker session",
      rationale: [
        `Worker session ${session.id} failed without a structured final report.`,
        "The Steward needs to decide whether to resume, correct the Worker, or ask the owner before continuing.",
        memory.summary
      ]
        .filter((line): line is string => line !== null)
        .join(" "),
      risk: "high",
      confidence: 0.64,
      reversible: true,
      needsHumanReview: true,
      status: "active",
      actions: [
        `Worker session: ${session.id}`,
        nextAction,
        "Decide whether to resume, correct, or ask the owner.",
        ...(memory.summary === null ? [] : [`Memory applied: ${memory.summary}`])
      ]
    });

    decisionsRecorded += 1;
    ownerReviewNeeded += 1;
    queuedActions.push({
      goalId: goal.id,
      workerSessionId: session.id,
      nextAction,
      memorySummary: memory.summary,
      handoffQueued: false,
      ownerReviewNeeded: true
    });
  }

  const finalDashboard = await input.store.dashboard();
  const recovery = buildStewardRecoveryReport(finalDashboard);
  const checkpoint = await input.store.recordStewardCheckpoint({
    reason: "manual",
    summary: buildCheckpointSummary({
      checked: reconcileResult.checked,
      updated: reconcileResult.updated,
      decisionsRecorded,
      handoffsQueued,
      ownerReviewNeeded
    }),
    nextAction: buildCheckpointNextAction(queuedActions, recovery.nextActions),
    goalIds: uniqueStrings([...supervisedSessions.map((session) => session.goalId), ...queuedActions.map((action) => action.goalId)]),
    workerSessionIds: uniqueStrings([
      ...supervisedSessions.map((session) => session.id),
      ...queuedActions.map((action) => action.workerSessionId)
    ])
  });

  return {
    result: {
      checked: reconcileResult.checked,
      updated: reconcileResult.updated,
      decisionsRecorded,
      handoffsQueued,
      ownerReviewNeeded
    },
    checkpoint
  };
}

function hasDecisionAction(decisions: StewardDecision[], action: string): boolean {
  return decisions.some((decision) => parseDecisionActions(decision).includes(action));
}

function parseDecisionActions(decision: StewardDecision): string[] {
  try {
    const parsed = JSON.parse(decision.actionsJson) as unknown;

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function buildReportNextAction(report: WorkerReport, ownerReviewNeeded: boolean): string {
  const requestedAction = report.nextActions[0];

  if (requestedAction !== undefined) {
    return requestedAction;
  }

  if (ownerReviewNeeded) {
    return `Review Worker report ${report.id} before continuing the goal.`;
  }

  return `Review Worker report ${report.id} and prepare the merge handoff.`;
}

function buildFailedSessionNextAction(session: WorkerSession): string {
  const output = summarizeOutput(session.lastOutput);

  if (output === "") {
    return `Review failed Worker session ${session.id}.`;
  }

  return `Review failed Worker session ${session.id}: ${output}`;
}

function summarizeOutput(output: string): string {
  const summary = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");

  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
}

function buildCheckpointSummary(result: StewardAutonomyTickResult): string {
  return [
    `Autonomy tick checked ${result.checked} ${result.checked === 1 ? "Worker session" : "Worker sessions"}`,
    `updated ${result.updated}`,
    `recorded ${result.decisionsRecorded} ${result.decisionsRecorded === 1 ? "decision" : "decisions"}`,
    `queued ${result.handoffsQueued} ${result.handoffsQueued === 1 ? "handoff" : "handoffs"}`,
    `flagged ${result.ownerReviewNeeded} owner ${result.ownerReviewNeeded === 1 ? "review" : "reviews"}`
  ].join(", ") + ".";
}

function buildCheckpointNextAction(queuedActions: QueuedAction[], recoveryActions: string[]): string {
  const queuedAction = queuedActions[0];

  if (queuedAction !== undefined) {
    return [
      queuedAction.nextAction,
      queuedAction.ownerReviewNeeded ? "Owner review required." : null,
      queuedAction.handoffQueued ? "Review/merge handoff queued." : null,
      queuedAction.memorySummary === null ? null : `Memory applied: ${queuedAction.memorySummary}`
    ]
      .filter((line): line is string => line !== null)
      .join(" ");
  }

  return (
    recoveryActions.find((action) => !action.startsWith("Checkpoint: ")) ??
    recoveryActions[0] ??
    "No follow-up action is queued; continue monitoring Steward state."
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
