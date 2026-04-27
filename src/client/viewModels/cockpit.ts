import type { ClientDashboardData, ClientGoal } from "../api.js";
import type { StewardDecision, WorkerReport } from "../../shared/types.js";

export type InboxItemKind = "decision" | "report";

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  goalId: string;
  workerSessionId: string | null;
  decisionId: string | null;
  title: string;
  summary: string;
  reason: string;
  status: string;
  risk: "low" | "medium" | "high" | null;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  projectName: string;
  workspacePath: string | null;
  goals: ClientGoal[];
  activeGoalCount: number;
  runningWorkerCount: number;
  latestDecisionTitle: string | null;
  latestWorkerReportStatus: string | null;
  latestWorkerReportTitle: string | null;
  nextOwnerAction: string;
  updatedAt: string;
}

export interface CockpitSelection {
  projectName: string;
  workspacePath: string;
}

export interface CockpitBrief {
  projectName: string;
  workspacePath: string | null;
  activeGoalTitle: string;
  humanReviewCount: number;
  runningWorkerCount: number;
  remoteReadyCount: number;
  nextSafeAction: string;
}

const importantReportPattern = /\b(blocked?|blocker|failed|failure|verification|merge|release|security|owner review|double-check)\b/i;

export function buildInboxItems(dashboard: ClientDashboardData): InboxItem[] {
  return [
    ...dashboard.decisions.filter(isOwnerVisibleDecision).map((decision) => decisionToInboxItem(decision)),
    ...dashboard.workerReports.filter(isOwnerVisibleReport).map((report) => reportToInboxItem(report))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function buildProjectSummaries(dashboard: ClientDashboardData, inboxItems: InboxItem[]): ProjectSummary[] {
  const goalsById = new Map(dashboard.goals.map((goal) => [goal.id, goal]));
  const groupedGoals = new Map<string, ClientGoal[]>();

  for (const goal of dashboard.goals) {
    const key = projectKey(goal.projectName, goal.workspacePath ?? null);
    groupedGoals.set(key, [...(groupedGoals.get(key) ?? []), goal]);
  }

  return [...groupedGoals.entries()]
    .map(([key, goals]) => {
      const [projectName, rawWorkspacePath = ""] = key.split("\u0000");
      const workspacePath = rawWorkspacePath === "" ? null : rawWorkspacePath;
      const goalIds = new Set(goals.map((goal) => goal.id));
      const relatedWorkers = dashboard.workerSessions.filter((session) => goalIds.has(session.goalId));
      const relatedDecisions = dashboard.decisions.filter((decision) => goalIds.has(decision.goalId));
      const relatedReports = dashboard.workerReports.filter((report) => goalIds.has(report.goalId));
      const relatedInbox = inboxItems.filter((item) => goalIds.has(item.goalId));
      const activeGoals = goals.filter((goal) => goal.status === "queued" || goal.status === "running" || goal.status === "blocked");
      const latestDecision = latestByCreatedAt(relatedDecisions);
      const latestReport = latestByCreatedAt(relatedReports);
      const latestGoal = latestByUpdatedAt(goals);

      return {
        id: key,
        projectName,
        workspacePath,
        goals: [...goals].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        activeGoalCount: activeGoals.length,
        runningWorkerCount: relatedWorkers.filter((session) => session.status === "running").length,
        latestDecisionTitle: latestDecision?.title ?? null,
        latestWorkerReportStatus: latestReport?.status ?? null,
        latestWorkerReportTitle: latestReport === null || latestReport === undefined ? null : reportTitle(latestReport),
        nextOwnerAction: relatedInbox[0]?.title ?? "No owner action queued.",
        updatedAt: latestGoal?.updatedAt ?? "1970-01-01T00:00:00.000Z"
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function buildCockpitBrief(
  dashboard: ClientDashboardData,
  projects: ProjectSummary[],
  inboxItems: InboxItem[],
  selection: CockpitSelection
): CockpitBrief {
  const selectedProject = selectProject(projects, selection);
  const activeGoal = selectedProject?.goals.find((goal) => goal.status === "running" || goal.status === "blocked") ?? selectedProject?.goals[0] ?? null;
  const selectedGoalIds = new Set(selectedProject?.goals.map((goal) => goal.id) ?? []);

  return {
    projectName: selectedProject?.projectName ?? nonEmpty(selection.projectName) ?? "No project selected",
    workspacePath: selectedProject?.workspacePath ?? nonEmpty(selection.workspacePath),
    activeGoalTitle: activeGoal?.title ?? "No active goal selected.",
    humanReviewCount: dashboard.decisions.filter((decision) => selectedGoalIds.has(decision.goalId) && decision.needsHumanReview).length,
    runningWorkerCount: dashboard.workerSessions.filter(
      (session) => selectedGoalIds.has(session.goalId) && session.status === "running"
    ).length,
    remoteReadyCount: dashboard.executionNodes.filter((node) => node.kind === "remote" && node.status === "ready").length,
    nextSafeAction: nextSafeActionForSelection(selectedProject, inboxItems)
  };
}

function decisionToInboxItem(decision: StewardDecision): InboxItem {
  return {
    id: `decision:${decision.id}`,
    kind: "decision",
    goalId: decision.goalId,
    workerSessionId: decision.workerSessionId,
    decisionId: decision.id,
    title: decision.title,
    summary: decision.rationale,
    reason: decisionReason(decision),
    status: decision.status,
    risk: decision.risk,
    createdAt: decision.createdAt
  };
}

function reportToInboxItem(report: WorkerReport): InboxItem {
  return {
    id: `report:${report.id}`,
    kind: "report",
    goalId: report.goalId,
    workerSessionId: report.workerSessionId,
    decisionId: null,
    title: reportTitle(report),
    summary: reportSummary(report),
    reason: reportReason(report),
    status: report.status,
    risk: report.status === "BLOCKED" ? "high" : "medium",
    createdAt: report.createdAt
  };
}

function isOwnerVisibleDecision(decision: StewardDecision): boolean {
  return decision.needsHumanReview || decision.risk === "medium" || decision.risk === "high" || decision.status === "corrected";
}

function isOwnerVisibleReport(report: WorkerReport): boolean {
  return (
    report.needsOwnerReview ||
    report.status === "BLOCKED" ||
    report.status === "DONE_WITH_CONCERNS" ||
    report.blockers.length > 0 ||
    reportFields(report).some((value) => importantReportPattern.test(value))
  );
}

function decisionReason(decision: StewardDecision): string {
  if (decision.needsHumanReview) {
    return "needs human review";
  }

  if (decision.status === "corrected") {
    return "corrected Steward decision";
  }

  return `${decision.risk}-risk Steward decision`;
}

function reportReason(report: WorkerReport): string {
  const fields = reportFields(report).join("\n");

  if (/\b(merge|release|security)\b/i.test(fields)) {
    return "merge / release / security signal";
  }

  if (report.needsOwnerReview) {
    return "Worker report needs owner review";
  }

  if (report.status === "BLOCKED" || report.blockers.length > 0) {
    return "Worker blocker";
  }

  return "verification risk";
}

function reportTitle(report: WorkerReport): string {
  return report.nextActions[0] ?? report.blockers[0] ?? report.decisions[0] ?? "Worker report needs owner review";
}

function reportSummary(report: WorkerReport): string {
  return report.blockers[0] ?? report.verification[0] ?? report.nextActions[0] ?? "No report summary recorded.";
}

function reportFields(report: WorkerReport): string[] {
  return [
    ...report.verification,
    ...report.decisions,
    ...report.blockers,
    ...report.nextActions,
    report.markdown
  ];
}

function projectKey(projectName: string, workspacePath: string | null): string {
  return `${projectName || "untitled"}\u0000${workspacePath ?? ""}`;
}

function latestByCreatedAt<T extends { createdAt: string }>(values: T[]): T | null {
  return [...values].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function latestByUpdatedAt<T extends { updatedAt: string }>(values: T[]): T | null {
  return [...values].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

function selectProject(projects: ProjectSummary[], selection: CockpitSelection): ProjectSummary | null {
  const workspacePath = selection.workspacePath.trim();
  const projectName = selection.projectName.trim();

  if (workspacePath !== "") {
    return projects.find((project) => project.workspacePath === workspacePath) ?? projects[0] ?? null;
  }

  if (projectName !== "") {
    return projects.find((project) => project.projectName === projectName) ?? projects[0] ?? null;
  }

  return projects[0] ?? null;
}

function nextSafeActionForSelection(project: ProjectSummary | null, inboxItems: InboxItem[]): string {
  if (project === null) {
    return inboxItems[0]?.title ?? "Start by selecting a project workspace.";
  }

  return project.nextOwnerAction;
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
