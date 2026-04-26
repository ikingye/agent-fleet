import type {
  DashboardData,
  RecoveryWorkerSession,
  StewardCheckpoint,
  StewardMessage,
  StewardRecoveryReport,
  WorkerSessionStatus
} from "../../shared/types.js";
import { buildResumeCommand } from "../workers/resumeCommand.js";

const activeGoalStatuses = new Set(["queued", "running", "blocked"]);
const activeWorkerStatuses = new Set<WorkerSessionStatus>(["starting", "running", "paused"]);

export function buildStewardRecoveryReport(
  dashboard: DashboardData,
  generatedAt = new Date().toISOString()
): StewardRecoveryReport {
  const lastCheckpoint = latestCheckpoint(dashboard.stewardCheckpoints);
  const activeGoals = dashboard.goals.filter((goal) => activeGoalStatuses.has(goal.status));
  const activeGoalIds = activeGoals.map((goal) => goal.id);
  const activeWorkerSessions = dashboard.workerSessions
    .filter((session) => activeWorkerStatuses.has(session.status))
    .map<RecoveryWorkerSession>((session) => {
      const worktree = dashboard.worktreeAssignments.find((assignment) => assignment.workerSessionId === session.id);

      return {
        id: session.id,
        goalId: session.goalId,
        decisionId: session.decisionId,
        status: session.status,
        command: session.command,
        cwd: session.cwd,
        pid: session.pid,
        hostId: session.hostId,
        resumeId: session.resumeId,
        resumeCommand: buildResumeCommand({
          kind: session.kind,
          baseCommand: session.command,
          resumeId: session.resumeId
        }),
        worktreeAssignmentId: worktree?.id ?? null,
        repositoryPath: worktree?.repositoryPath ?? null,
        worktreePath: worktree?.worktreePath ?? null,
        branchName: worktree?.branchName ?? null,
        worktreeStatus: worktree?.status ?? null,
        lastOutput: session.lastOutput,
        updatedAt: session.updatedAt
      };
    });
  const recentStewardMessages = latestStewardMessages(dashboard.stewardMessages ?? [], 2);

  return {
    generatedAt,
    lastCheckpoint,
    activeGoalIds,
    activeGoals,
    activeWorkerSessions,
    recentStewardMessages,
    nextActions: buildNextActions(lastCheckpoint, activeWorkerSessions, recentStewardMessages)
  };
}

function latestCheckpoint(checkpoints: StewardCheckpoint[]): StewardCheckpoint | null {
  let latest: StewardCheckpoint | null = null;

  for (const checkpoint of checkpoints) {
    if (latest === null || Date.parse(checkpoint.createdAt) >= Date.parse(latest.createdAt)) {
      latest = checkpoint;
    }
  }

  return latest;
}

function buildNextActions(
  lastCheckpoint: StewardCheckpoint | null,
  activeWorkerSessions: RecoveryWorkerSession[],
  recentStewardMessages: StewardMessage[]
): string[] {
  const actions: string[] = [];

  if (lastCheckpoint !== null) {
    actions.push(`Checkpoint: ${lastCheckpoint.nextAction}`);
  }

  for (const session of activeWorkerSessions) {
    if (session.resumeCommand === null) {
      actions.push(
        `Probe Worker session ${session.id} in ${session.cwd}; if the process is gone, mark it failed because no resume id is available.`
      );
      continue;
    }

    if (session.status === "paused") {
      actions.push(`Resume paused Worker session ${session.id} in ${session.cwd} with: ${session.resumeCommand}`);
      continue;
    }

    actions.push(
      `Inspect Worker session ${session.id} in ${session.cwd}; if the process is gone, run: ${session.resumeCommand}`
    );
  }

  if (activeWorkerSessions.length === 0) {
    actions.push(
      "No active Worker sessions. Review queued, running, or blocked goals and decide whether to dispatch a new Worker Agent."
    );
  }

  if (recentStewardMessages.length > 0) {
    actions.push(
      "Recent Steward chat is available; review the latest owner/steward messages before dispatching more Worker Agents."
    );
  }

  return actions;
}

function latestStewardMessages(messages: StewardMessage[], limit: number): StewardMessage[] {
  return [...messages]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-limit);
}
