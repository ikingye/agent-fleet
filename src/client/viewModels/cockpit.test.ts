import { describe, expect, it } from "vitest";
import type { ClientDashboardData } from "../api.js";
import { buildCockpitBrief, buildInboxItems, buildProjectSummaries } from "./cockpit.js";

const baseDashboard: ClientDashboardData = {
  goals: [
    {
      id: "goal-1",
      projectName: "agent-fleet",
      workspacePath: "/workspaces/agent-fleet",
      title: "Build cockpit",
      body: "Make Steward cockpit clearer.",
      status: "running",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    },
    {
      id: "goal-2",
      projectName: "mahjong",
      workspacePath: "/workspaces/mahjong",
      title: "Build Mahjong",
      body: "Ship the Mahjong MVP.",
      status: "running",
      createdAt: "2026-04-26T00:01:00.000Z",
      updatedAt: "2026-04-26T00:01:00.000Z"
    }
  ],
  decisions: [
    {
      id: "decision-1",
      goalId: "goal-1",
      workerSessionId: "worker-1",
      title: "Merge remote Worker branch",
      rationale: "Medium-risk merge should be visible.",
      risk: "medium",
      confidence: 0.7,
      reversible: true,
      needsHumanReview: false,
      status: "active",
      actionsJson: "[]",
      createdAt: "2026-04-26T00:03:00.000Z"
    },
    {
      id: "decision-2",
      goalId: "goal-2",
      workerSessionId: "worker-2",
      title: "Apply owner correction",
      rationale: "Owner corrected the Steward decision.",
      risk: "low",
      confidence: 0.9,
      reversible: true,
      needsHumanReview: false,
      status: "corrected",
      actionsJson: "[]",
      createdAt: "2026-04-26T00:04:00.000Z"
    }
  ],
  workerSessions: [
    {
      id: "worker-1",
      goalId: "goal-1",
      decisionId: "decision-1",
      kind: "codex",
      providerId: null,
      providerType: null,
      model: null,
      command: "codex",
      cwd: "/workspaces/agent-fleet/.worktrees/cockpit",
      pid: 10,
      hostId: "node-1",
      resumeId: "resume-1",
      status: "running",
      lastOutput: "",
      createdAt: "2026-04-26T00:02:00.000Z",
      updatedAt: "2026-04-26T00:02:00.000Z"
    },
    {
      id: "worker-2",
      goalId: "goal-2",
      decisionId: "decision-2",
      kind: "claude_code",
      providerId: null,
      providerType: null,
      model: null,
      command: "claude",
      cwd: "/workspaces/mahjong/.worktrees/mvp",
      pid: null,
      hostId: "node-1",
      resumeId: "resume-2",
      status: "failed",
      lastOutput: "",
      createdAt: "2026-04-26T00:02:00.000Z",
      updatedAt: "2026-04-26T00:02:00.000Z"
    }
  ],
  workerReports: [
    {
      id: "report-1",
      goalId: "goal-2",
      workerSessionId: "worker-2",
      status: "DONE",
      changedFiles: [],
      verification: ["verification failed in release flow"],
      decisions: [],
      blockers: [],
      nextActions: ["Owner should review release risk."],
      needsOwnerReview: false,
      resumeId: "resume-2",
      markdown: "release merge security check needs attention",
      createdAt: "2026-04-26T00:05:00.000Z"
    }
  ],
  corrections: [],
  memories: [],
  executionNodes: [
    {
      id: "node-1",
      name: "remote-1",
      kind: "remote",
      status: "ready",
      sshHost: "worker@example",
      workRoot: "/tmp/agent-fleet",
      proxyUrl: null,
      tags: ["remote"],
      capacity: 2,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  githubDeployKeyLeases: [],
  worktreeAssignments: [],
  stewardCheckpoints: [],
  agentArtifacts: [],
  reviews: [],
  deliveryReports: [],
  stewardMessages: [],
  events: []
};

describe("cockpit view models", () => {
  it("builds an owner Inbox from decisions and risk-bearing Worker reports", () => {
    const inboxItems = buildInboxItems(baseDashboard);

    expect(inboxItems.map((item) => item.title)).toEqual([
      "Owner should review release risk.",
      "Apply owner correction",
      "Merge remote Worker branch"
    ]);
    expect(inboxItems[0]).toMatchObject({
      kind: "report",
      reason: "merge / release / security signal"
    });
    expect(inboxItems[1]).toMatchObject({
      kind: "decision",
      reason: "corrected Steward decision"
    });
  });

  it("groups projects by workspace and attaches current activity", () => {
    const inboxItems = buildInboxItems(baseDashboard);
    const projects = buildProjectSummaries(baseDashboard, inboxItems);

    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({
      projectName: "mahjong",
      workspacePath: "/workspaces/mahjong",
      activeGoalCount: 1,
      runningWorkerCount: 0,
      latestDecisionTitle: "Apply owner correction",
      latestWorkerReportStatus: "DONE",
      nextOwnerAction: "Owner should review release risk."
    });
    expect(projects[1]).toMatchObject({
      projectName: "agent-fleet",
      workspacePath: "/workspaces/agent-fleet",
      activeGoalCount: 1,
      runningWorkerCount: 1,
      nextOwnerAction: "Merge remote Worker branch"
    });
  });

  it("builds the current brief from the selected workspace when provided", () => {
    const inboxItems = buildInboxItems(baseDashboard);
    const projects = buildProjectSummaries(baseDashboard, inboxItems);
    const brief = buildCockpitBrief(baseDashboard, projects, inboxItems, {
      projectName: "mahjong",
      workspacePath: "/workspaces/mahjong"
    });

    expect(brief).toMatchObject({
      projectName: "mahjong",
      workspacePath: "/workspaces/mahjong",
      activeGoalTitle: "Build Mahjong",
      humanReviewCount: 0,
      runningWorkerCount: 0,
      remoteReadyCount: 1,
      nextSafeAction: "Owner should review release risk."
    });
  });
});
