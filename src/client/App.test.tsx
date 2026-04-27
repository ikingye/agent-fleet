import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

function fixturePath(...parts: string[]): string {
  return ["", ...parts].join("/");
}

const exampleOwnerMahjongWorkspace = fixturePath("Users", "example-owner", "code", "project", "mahjong");
const exampleLinuxMahjongWorkspace = fixturePath("home", "builder", "work", "mahjong");
const currentOwnerHome = fixturePath("srv", "home", "current-owner");
const currentOwnerAgentFleetWorkspace = `${currentOwnerHome}/code/project/agent-fleet`;

const dashboard = {
  goals: [
    {
      id: "goal-1",
      projectName: "agent-fleet",
      workspacePath: "/workspaces/agent-fleet",
      title: "Bootstrap agent-fleet",
      body: "Build the Steward/Worker loop.",
      status: "running",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  decisions: [
    {
      id: "decision-1",
      goalId: "goal-1",
      workerSessionId: "worker-1",
      title: "Start Worker Agent for goal",
      rationale: "The request is executable and reversible enough to start autonomously.",
      risk: "medium",
      confidence: 0.72,
      reversible: true,
      needsHumanReview: true,
      status: "active",
      actionsJson: "[\"Start Worker Agent\"]",
      createdAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  workerSessions: [
    {
      id: "worker-1",
      goalId: "goal-1",
      decisionId: "decision-1",
      kind: "codex",
      command: "codexyoloproxy",
      cwd: "/worktrees/agent-fleet",
      pid: 4242,
      hostId: "node-1",
      resumeId: "resume-1",
      status: "running",
      lastOutput: "raw worker stdout should stay hidden by default",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  workerReports: [
    {
      id: "report-1",
      goalId: "goal-1",
      workerSessionId: "worker-1",
      status: "BLOCKED",
      changedFiles: ["src/client/App.tsx", "src/client/api.ts"],
      verification: ["npm run test -- src/client/App.test.tsx"],
      decisions: ["Keep raw Worker chatter collapsed by default."],
      blockers: ["Owner needs to review stale Worker recovery risk."],
      nextActions: ["Run recovery reconcile before dispatching more Worker Agents."],
      needsOwnerReview: true,
      resumeId: "resume-1",
      markdown: "RAW_REPORT_MARKDOWN command stdout resume mechanics should stay hidden",
      createdAt: "2026-04-26T00:03:00.000Z"
    }
  ],
  stewardMessages: [
    {
      id: "message-1",
      role: "owner",
      projectName: "agent-fleet",
      workspacePath: "/workspaces/agent-fleet",
      goalId: "goal-1",
      body: "Please keep Worker execution durable.",
      createdAt: "2026-04-26T00:00:30.000Z"
    },
    {
      id: "message-2",
      role: "steward",
      projectName: "agent-fleet",
      workspacePath: "/workspaces/agent-fleet",
      goalId: "goal-1",
      body: "I will record the decision trail before dispatching work.",
      createdAt: "2026-04-26T00:00:40.000Z"
    },
    {
      id: "message-3",
      role: "worker",
      projectName: "agent-fleet",
      workspacePath: "/workspaces/agent-fleet",
      goalId: "goal-1",
      body: "WORKER_PROTOCOL: spawned process details and tool chatter",
      createdAt: "2026-04-26T00:00:50.000Z"
    }
  ],
  corrections: [],
  memories: [],
  executionNodes: [
    {
      id: "node-1",
      name: "remote-build-1",
      kind: "remote",
      status: "ready",
      sshHost: "worker@remote-build-1.example",
      workRoot: "/srv/agent-fleet/worktrees",
      proxyUrl: "https://proxy.agent-fleet.example",
      tags: ["remote", "linux", "high-cpu"],
      capacity: 2,
      lastNote: "ready for remote verification",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  worktreeAssignments: [
    {
      id: "worktree-1",
      workerSessionId: "worker-1",
      repositoryPath: "/repos/agent-fleet",
      worktreePath: "/worktrees/agent-fleet-dashboard-execution",
      branchName: "steward/dashboard-execution",
      status: "planned",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  events: [
    {
      id: "event-1",
      type: "decision.recorded",
      goalId: "goal-1",
      decisionId: "decision-1",
      workerSessionId: null,
      message: "Steward recorded a medium-risk decision for human review.",
      metadataJson: "{\"risk\":\"medium\"}",
      createdAt: "2026-04-26T00:01:00.000Z"
    },
    {
      id: "event-2",
      type: "worker.started",
      goalId: "goal-1",
      decisionId: "decision-1",
      workerSessionId: "worker-1",
      message: "Worker Agent session started with resume id resume-1.",
      metadataJson: "{\"resumeId\":\"resume-1\"}",
      createdAt: "2026-04-26T00:02:00.000Z"
    }
  ]
};

function jsonResponse(value: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(value)
  };
}

function notFoundResponse() {
  return {
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: "Not Found" })
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(dashboard)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a compact management dashboard without business project UI", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "agent-fleet" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Goals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recovery" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Remote" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Help" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Docs" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("navigation", { name: "Control plane sections" })).toHaveClass("sidebar-nav");
    expect(screen.getByRole("region", { name: "Steward console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Current Brief" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Steward context" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Steward Chat" })).toBeInTheDocument();
    expect(screen.getByText("Please keep Worker execution durable.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Steward Intake" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Key Decisions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Active Worker Summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Worker Operations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Recovery Context" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Remote Nodes" })).not.toBeInTheDocument();
    expect(screen.queryByText("codexyoloproxy")).not.toBeInTheDocument();
    expect(screen.queryByText("pid 4242")).not.toBeInTheDocument();
    expect(screen.queryByText("codexyoloproxy resume resume-1")).not.toBeInTheDocument();
    expect(screen.queryByText("raw worker stdout should stay hidden by default")).not.toBeInTheDocument();
    expect(screen.queryByText("WORKER_PROTOCOL: spawned process details and tool chatter")).not.toBeInTheDocument();
    expect(screen.getByText("1 Worker message hidden")).toBeInTheDocument();
    expect(screen.queryByText(/Mahjong Arena/i)).not.toBeInTheDocument();
  });

  it("presents Chat as a Steward console with concise status instead of raw Worker detail", async () => {
    render(<App />);

    const consoleRegion = await screen.findByRole("region", { name: "Steward console" });
    const statusPanel = within(consoleRegion).getByRole("region", { name: "Current Brief" });

    expect(within(consoleRegion).getByRole("heading", { level: 2, name: "Steward Chat" })).toBeInTheDocument();
    expect(within(statusPanel).getByText("Current Brief")).toBeInTheDocument();
    expect(within(statusPanel).getByText("/workspaces/agent-fleet")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Bootstrap agent-fleet")).toBeInTheDocument();
    expect(within(statusPanel).getByText("1 decision for review")).toBeInTheDocument();
    expect(within(statusPanel).getByText("1 Worker running")).toBeInTheDocument();
    expect(within(statusPanel).getByText("1 remote node ready")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Next safe action")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Run recovery reconcile before dispatching more Worker Agents.")).toBeInTheDocument();
    expect(screen.queryByText("raw worker stdout should stay hidden by default")).not.toBeInTheDocument();
    expect(screen.queryByText("codexyoloproxy resume resume-1")).not.toBeInTheDocument();
  });

  it("switches from Chat to Inbox through the left sidebar and shows the owner action queue", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: "Steward Chat" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Owner Inbox" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Inbox" }));

    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { level: 2, name: "Owner Inbox" })).toBeInTheDocument();
    expect(screen.getAllByText("Start Worker Agent for goal").length).toBeGreaterThan(0);
    expect(screen.getByText("needs review")).toBeInTheDocument();
    expect(screen.getByText("owner double-check")).toBeInTheDocument();
    expect(screen.getByText("Worker report needs owner review")).toBeInTheDocument();
    expect(screen.getAllByText("Owner needs to review stale Worker recovery risk.").length).toBeGreaterThan(0);
    const decisionResource = screen.getByRole("group", { name: "Decision resource remote-build-1" });
    expect(within(decisionResource).getByText("remote-build-1")).toBeInTheDocument();
    expect(within(decisionResource).getByText("ready")).toBeInTheDocument();
    expect(within(decisionResource).getByText("2 slots")).toBeInTheDocument();
    expect(within(decisionResource).getByText("remote, linux, high-cpu")).toBeInTheDocument();
    expect(within(decisionResource).getByText("https://proxy.agent-fleet.example")).toBeInTheDocument();
    expect(within(decisionResource).getByText("ready for remote verification")).toBeInTheDocument();
  });

  it("shows Projects grouped by project and workspace with next owner action", async () => {
    const multiProjectDashboard = {
      ...dashboard,
      goals: [
        dashboard.goals[0],
        {
          id: "goal-2",
          projectName: "mahjong",
          workspacePath: exampleOwnerMahjongWorkspace,
          title: "Ship Mahjong playable MVP",
          body: "Keep Mahjong implementation in its own workspace.",
          status: "running",
          createdAt: "2026-04-26T00:04:00.000Z",
          updatedAt: "2026-04-26T00:04:00.000Z"
        }
      ],
      workerSessions: [
        dashboard.workerSessions[0],
        {
          ...dashboard.workerSessions[0],
          id: "worker-2",
          goalId: "goal-2",
          decisionId: "decision-2",
          cwd: `${exampleOwnerMahjongWorkspace}/.worktrees/playable-mvp`,
          resumeId: "resume-2"
        }
      ],
      decisions: [
        dashboard.decisions[0],
        {
          ...dashboard.decisions[0],
          id: "decision-2",
          goalId: "goal-2",
          workerSessionId: "worker-2",
          title: "Review Mahjong release scope",
          rationale: "Release and merge scope needs owner visibility.",
          risk: "high",
          confidence: 0.64,
          needsHumanReview: true,
          actionsJson: "[\"Review release scope\"]",
          createdAt: "2026-04-26T00:05:00.000Z"
        }
      ],
      workerReports: [
        dashboard.workerReports[0],
        {
          ...dashboard.workerReports[0],
          id: "report-2",
          goalId: "goal-2",
          workerSessionId: "worker-2",
          status: "DONE_WITH_CONCERNS",
          blockers: [],
          nextActions: ["Owner should double-check release scope before merge."],
          markdown: "release merge safety review",
          createdAt: "2026-04-26T00:06:00.000Z"
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(multiProjectDashboard)));
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Projects" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Projects" })).toBeInTheDocument();
    const mahjongProject = screen.getByRole("group", { name: "Project mahjong" });
    expect(within(mahjongProject).getByText("~/code/project/mahjong")).toBeInTheDocument();
    expect(within(mahjongProject).getByText("Ship Mahjong playable MVP")).toBeInTheDocument();
    expect(within(mahjongProject).getByText("1 active goal")).toBeInTheDocument();
    expect(within(mahjongProject).getByText("1 running Worker")).toBeInTheDocument();
    expect(within(mahjongProject).getByText("Review Mahjong release scope")).toBeInTheDocument();
    expect(within(mahjongProject).getByText("Owner should double-check release scope before merge.")).toBeInTheDocument();
    expect(screen.queryByText((text) => text.includes(exampleOwnerMahjongWorkspace))).not.toBeInTheDocument();
    expect(screen.queryByText(/Mahjong Arena/i)).not.toBeInTheDocument();
  });

  it("makes external workspace context explicit in Steward intake", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Goals" }));

    const targetDirectory = await screen.findByLabelText("Target directory");
    expect(targetDirectory).toBeRequired();
    expect(targetDirectory).toHaveAttribute("placeholder", "~/code/project/target");
    expect(screen.getByText("External workspace path required")).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Goal body")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message Steward")).not.toBeInTheDocument();
  });

  it("shows Worker session debug details only after expanding operations", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workers" }));

    const workerPanel = await screen.findByRole("region", { name: "Worker Operations" });
    expect(within(workerPanel).getByText("1 running")).toBeInTheDocument();
    expect(within(workerPanel).queryByText("codexyoloproxy")).not.toBeInTheDocument();
    expect(within(workerPanel).queryByText("raw worker stdout should stay hidden by default")).not.toBeInTheDocument();

    await user.click(within(workerPanel).getByText("Debug details"));

    expect(within(workerPanel).getByText("codexyoloproxy")).toBeInTheDocument();
    expect(within(workerPanel).getByText("pid 4242")).toBeInTheDocument();
    expect(within(workerPanel).getByText("codexyoloproxy resume resume-1")).toBeInTheDocument();
    expect(within(workerPanel).getByText("raw worker stdout should stay hidden by default")).toBeInTheDocument();
  });

  it("shows Worker report-derived status and risks without raw report chatter", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Inbox" }));

    const reportPanel = await screen.findByRole("region", { name: "Worker Report Summary" });
    expect(within(reportPanel).getByText("BLOCKED")).toBeInTheDocument();
    expect(within(reportPanel).getByText("needs owner review")).toBeInTheDocument();
    expect(within(reportPanel).getByText("Bootstrap agent-fleet")).toBeInTheDocument();
    expect(within(reportPanel).getByText("Start Worker Agent for goal")).toBeInTheDocument();
    expect(within(reportPanel).getByText("npm run test -- src/client/App.test.tsx")).toBeInTheDocument();
    expect(within(reportPanel).getByText("Owner needs to review stale Worker recovery risk.")).toBeInTheDocument();
    expect(within(reportPanel).getByText("Run recovery reconcile before dispatching more Worker Agents.")).toBeInTheDocument();
    expect(within(reportPanel).getByText("src/client/App.tsx, src/client/api.ts")).toBeInTheDocument();
    expect(screen.queryByText("RAW_REPORT_MARKDOWN command stdout resume mechanics should stay hidden")).not.toBeInTheDocument();
  });

  it("runs autonomy and recovery reconcile actions then refreshes dashboard state", async () => {
    const autonomyDashboard = {
      ...dashboard,
      stewardCheckpoints: [
        {
          id: "checkpoint-autonomy",
          reason: "manual",
          summary: "Autonomy reconcile checked 1 Worker session and updated 1.",
          nextAction: "Review stale Worker sessions before dispatching more work.",
          goalIds: ["goal-1"],
          workerSessionIds: ["worker-1"],
          createdAt: "2026-04-26T00:04:00.000Z"
        }
      ]
    };
    const reconciledDashboard = {
      ...autonomyDashboard,
      stewardCheckpoints: [
        ...autonomyDashboard.stewardCheckpoints,
        {
          id: "checkpoint-reconcile",
          reason: "recovery",
          summary: "Recovery reconcile checked 1 Worker session and updated 0.",
          nextAction: "Continue monitoring Worker sessions.",
          goalIds: ["goal-1"],
          workerSessionIds: ["worker-1"],
          createdAt: "2026-04-26T00:05:00.000Z"
        }
      ]
    };
    let currentDashboard: unknown = dashboard;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/dashboard") {
        return Promise.resolve(jsonResponse(currentDashboard));
      }

      if (url === "/api/conversations") {
        return Promise.resolve(notFoundResponse());
      }

      if (url === "/api/steward/autonomy/run" && method === "POST") {
        currentDashboard = autonomyDashboard;
        return Promise.resolve(jsonResponse({ result: { checked: 1, updated: 1 } }));
      }

      if (url === "/api/recovery/reconcile" && method === "POST") {
        currentDashboard = reconciledDashboard;
        return Promise.resolve(jsonResponse({ checked: 1, updated: 0 }));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Recovery" }));
    await user.click(screen.getByRole("button", { name: "Run autonomy tick" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/steward/autonomy/run", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("Autonomy reconcile checked 1 Worker session and updated 1.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reconcile recovery" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/recovery/reconcile", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("Recovery reconcile checked 1 Worker session and updated 0.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard");
  });

  it("shows supervision metrics for decisions, Worker sessions, and memory", async () => {
    render(<App />);

    const statusPanel = await screen.findByRole("region", { name: "Current Brief" });

    expect(within(statusPanel).getByText("Human Review")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Running Workers")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Remote Capacity")).toBeInTheDocument();
  });

  it("renders worktree assignments and remote execution nodes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Recovery" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Worktrees" })).toBeInTheDocument();
    expect(screen.getByText("steward/dashboard-execution")).toBeInTheDocument();
    expect(screen.getByText("/worktrees/agent-fleet-dashboard-execution")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Remote" }));

    expect(screen.getByRole("heading", { level: 2, name: "Remote Nodes" })).toBeInTheDocument();
    const remoteNodesPanel = screen.getByRole("heading", { level: 2, name: "Remote Nodes" }).closest("details");
    expect(remoteNodesPanel).not.toBeNull();
    expect(within(remoteNodesPanel as HTMLElement).getByText("worker@remote-build-1.example")).toBeInTheDocument();
    expect(within(remoteNodesPanel as HTMLElement).getByText("https://proxy.agent-fleet.example")).toBeInTheDocument();
    expect(within(remoteNodesPanel as HTMLElement).getByText("remote, linux, high-cpu")).toBeInTheDocument();
    expect(within(remoteNodesPanel as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("keeps docs links under Help instead of a primary Docs tab", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("tab", { name: "Help" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Docs" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Help" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub Pages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source docs" })).toBeInTheDocument();
  });

  it("registers a remote execution node and refreshes the dashboard", async () => {
    const refreshedDashboard = {
      ...dashboard,
      executionNodes: [
        ...dashboard.executionNodes,
        {
          id: "node-2",
          name: "mac-mini-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@remote-worker.example",
          workRoot: "/tmp/agent-fleet/work",
          proxyUrl: "http://127.0.0.1:1080",
          tags: ["remote", "linux", "high-cpu"],
          capacity: 3,
          createdAt: "2026-04-26T00:03:00.000Z",
          updatedAt: "2026-04-26T00:03:00.000Z"
        }
      ]
    };
    let currentDashboard: unknown = dashboard;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/dashboard") {
        return Promise.resolve(jsonResponse(currentDashboard));
      }

      if (url === "/api/conversations") {
        return Promise.resolve(notFoundResponse());
      }

      if (url === "/api/execution-nodes" && method === "POST") {
        currentDashboard = refreshedDashboard;
        return Promise.resolve(jsonResponse(refreshedDashboard.executionNodes[1]));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Remote" }));

    await user.type(await screen.findByLabelText("Remote node name"), "mac-mini-builder");
    await user.type(screen.getByLabelText("SSH host"), "worker@remote-worker.example");
    await user.type(screen.getByLabelText("Work root"), "/tmp/agent-fleet/work");
    await user.type(screen.getByLabelText("Proxy URL"), "http://127.0.0.1:1080");
    await user.type(screen.getByLabelText("Tags"), "remote, linux, high-cpu");
    await user.clear(screen.getByLabelText("Capacity"));
    await user.type(screen.getByLabelText("Capacity"), "3");
    await user.selectOptions(screen.getByLabelText("Remote node status"), "ready");
    await user.click(screen.getByRole("button", { name: "Register node" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/execution-nodes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "mac-mini-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@remote-worker.example",
          workRoot: "/tmp/agent-fleet/work",
          proxyUrl: "http://127.0.0.1:1080",
          tags: ["remote", "linux", "high-cpu"],
          capacity: 3
        })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard");
    expect(await screen.findByText("mac-mini-builder")).toBeInTheDocument();
  });

  it("renders recent control-plane audit events", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("heading", { level: 2, name: "Events / Audit" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("tab", { name: "Recovery" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Events / Audit" })).toBeInTheDocument();
    expect(screen.getByText("decision.recorded")).toBeInTheDocument();
    expect(screen.getByText("Steward recorded a medium-risk decision for human review.")).toBeInTheDocument();
    expect(screen.getByText("worker.started")).toBeInTheDocument();
    expect(screen.getByText("Worker Agent session started with resume id resume-1.")).toBeInTheDocument();
  });

  it("keeps active Worker sessions visible while collapsing stale failed history", async () => {
    const user = userEvent.setup();
    const staleDashboard = {
      ...dashboard,
      workerSessions: [
        {
          id: "worker-running",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "codex",
          command: "codex",
          cwd: "/worktrees/active",
          pid: 5151,
          hostId: null,
          resumeId: "resume-active",
          status: "running",
          lastOutput: "still running",
          createdAt: "2026-04-26T00:08:00.000Z",
          updatedAt: "2026-04-26T00:08:00.000Z"
        },
        {
          id: "worker-paused",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "claude_code",
          command: "claude",
          cwd: "/worktrees/paused",
          pid: null,
          hostId: null,
          resumeId: "resume-paused",
          status: "paused",
          lastOutput: "waiting",
          createdAt: "2026-04-26T00:07:00.000Z",
          updatedAt: "2026-04-26T00:07:00.000Z"
        },
        {
          id: "worker-failed-oldest",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "codex",
          command: "codex",
          cwd: "/worktrees/failed-oldest",
          pid: null,
          hostId: null,
          resumeId: "resume-failed-oldest",
          status: "failed",
          lastOutput: "stack trace from oldest failure",
          createdAt: "2026-04-26T00:01:00.000Z",
          updatedAt: "2026-04-26T00:01:00.000Z"
        },
        {
          id: "worker-failed-newer",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "codex",
          command: "codex",
          cwd: "/worktrees/failed-newer",
          pid: null,
          hostId: null,
          resumeId: "resume-failed-newer",
          status: "failed",
          lastOutput: "stack trace from newer failure",
          createdAt: "2026-04-26T00:03:00.000Z",
          updatedAt: "2026-04-26T00:03:00.000Z"
        },
        {
          id: "worker-completed-old",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "gemini_cli",
          command: "gemini",
          cwd: "/worktrees/completed-old",
          pid: null,
          hostId: null,
          resumeId: "resume-completed-old",
          status: "completed",
          lastOutput: "completed output",
          createdAt: "2026-04-26T00:02:00.000Z",
          updatedAt: "2026-04-26T00:02:00.000Z"
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(staleDashboard)));

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workers" }));

    const workerPanel = await screen.findByRole("region", { name: "Worker Operations" });
    expect(within(workerPanel).getByText("/worktrees/active")).toBeInTheDocument();
    expect(within(workerPanel).getByText("/worktrees/paused")).toBeInTheDocument();
    expect(within(workerPanel).queryByText("/worktrees/failed-oldest")).not.toBeInTheDocument();
    expect(within(workerPanel).getByText("3 historical sessions")).toBeInTheDocument();
    expect(within(workerPanel).queryByText("stack trace from oldest failure")).not.toBeInTheDocument();
  });

  it("shows collapsed Worker history output when expanded without tall failed cards", async () => {
    const staleDashboard = {
      ...dashboard,
      workerSessions: [
        {
          id: "worker-running",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "codex",
          command: "codex",
          cwd: "/worktrees/active",
          pid: 5151,
          hostId: null,
          resumeId: "resume-active",
          status: "running",
          lastOutput: "still running",
          createdAt: "2026-04-26T00:08:00.000Z",
          updatedAt: "2026-04-26T00:08:00.000Z"
        },
        {
          id: "worker-failed-oldest",
          goalId: "goal-1",
          decisionId: "decision-1",
          kind: "codex",
          command: "codex",
          cwd: "/worktrees/failed-oldest",
          pid: null,
          hostId: null,
          resumeId: "resume-failed-oldest",
          status: "failed",
          lastOutput: "stack trace from oldest failure",
          createdAt: "2026-04-26T00:01:00.000Z",
          updatedAt: "2026-04-26T00:01:00.000Z"
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(staleDashboard)));
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workers" }));

    const workerPanel = await screen.findByRole("region", { name: "Worker Operations" });
    await user.click(within(workerPanel).getByText("History"));

    const history = within(workerPanel).getByRole("group", { name: "Historical Worker sessions" });
    expect(within(history).getByText("codex")).toBeInTheDocument();
    expect(within(history).getByText("failed")).toBeInTheDocument();
    expect(within(history).getByText("/worktrees/failed-oldest")).toBeInTheDocument();
    expect(within(history).getByText("stack trace from oldest failure")).toBeInTheDocument();
  });

  it("filters known macOS Codex malloc diagnostics from Worker debug output", async () => {
    const noisyDashboard = {
      ...dashboard,
      workerSessions: [
        {
          ...dashboard.workerSessions[0],
          lastOutput: [
            "codex(84652) MallocStackLogging: can't turn off malloc stack logging because it was not enabled.",
            "real stderr line"
          ].join("\n")
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(noisyDashboard)));
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workers" }));
    const workerPanel = await screen.findByRole("region", { name: "Worker Operations" });
    await user.click(within(workerPanel).getByText("Debug details"));

    expect(within(workerPanel).queryByText(/MallocStackLogging/)).not.toBeInTheDocument();
    expect(within(workerPanel).getByText("real stderr line")).toBeInTheDocument();
  });

  it("submits a new goal to the Steward Agent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...dashboard, goals: [], decisions: [], workerSessions: [] }))
      .mockResolvedValueOnce(jsonResponse(dashboard.goals[0]))
      .mockResolvedValueOnce(jsonResponse(dashboard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Goals" }));

    await user.type(await screen.findByLabelText("Project"), "agent-fleet");
    await user.type(screen.getByLabelText("Target directory"), "/workspaces/mahjong");
    await user.type(screen.getByLabelText("Goal title"), "Bootstrap agent-fleet");
    await user.type(screen.getByLabelText("Goal body"), "Build the Steward/Worker loop.");
    await user.click(screen.getByRole("button", { name: "Start Steward" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/goals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectName: "agent-fleet",
          workspacePath: "/workspaces/mahjong",
          title: "Bootstrap agent-fleet",
          body: "Build the Steward/Worker loop."
        })
      })
    );
  });

  it("shows goal target directories", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Goals" }));

    expect(await screen.findByText("target")).toBeInTheDocument();
    expect(screen.getAllByText("/workspaces/agent-fleet").length).toBeGreaterThan(0);
  });

  it("displays owner home paths with a tilde without changing stored dashboard values", async () => {
    const homePathDashboard = {
      ...dashboard,
      goals: [
        {
          ...dashboard.goals[0],
          workspacePath: exampleOwnerMahjongWorkspace
        }
      ],
      workerSessions: [
        {
          ...dashboard.workerSessions[0],
          cwd: `${exampleOwnerMahjongWorkspace}/.worktrees/worker-1`
        }
      ],
      stewardMessages: [
        {
          ...dashboard.stewardMessages[0],
          workspacePath: exampleOwnerMahjongWorkspace
        }
      ],
      worktreeAssignments: [
        {
          ...dashboard.worktreeAssignments[0],
          repositoryPath: exampleOwnerMahjongWorkspace,
          worktreePath: `${exampleOwnerMahjongWorkspace}/.worktrees/worker-1`
        }
      ],
      executionNodes: [
        {
          ...dashboard.executionNodes[0],
          workRoot: `${exampleOwnerMahjongWorkspace}/.worktrees`
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(homePathDashboard)));

    render(<App />);

    expect((await screen.findAllByText("~/code/project/mahjong")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: "Goals" }));
    expect((await screen.findAllByText("~/code/project/mahjong")).length).toBeGreaterThanOrEqual(3);
    await userEvent.click(screen.getByRole("tab", { name: "Recovery" }));
    expect(screen.getAllByText("~/code/project/mahjong/.worktrees/worker-1").length).toBeGreaterThanOrEqual(2);
    await userEvent.click(screen.getByRole("tab", { name: "Remote" }));
    expect(screen.getByText("~/code/project/mahjong/.worktrees")).toBeInTheDocument();
    expect(screen.queryByText((text) => text.includes(exampleOwnerMahjongWorkspace))).not.toBeInTheDocument();
  });

  it("redacts generic home paths in dashboard text", async () => {
    vi.stubEnv("HOME", currentOwnerHome);
    const genericHomeDashboard = {
      ...dashboard,
      goals: [
        {
          ...dashboard.goals[0],
          workspacePath: exampleOwnerMahjongWorkspace,
          body: `Review ${exampleLinuxMahjongWorkspace} before dispatch.`
        }
      ],
      workerSessions: [
        {
          ...dashboard.workerSessions[0],
          cwd: `${exampleLinuxMahjongWorkspace}/.worktrees/worker-1`,
          lastOutput: `Remote cwd ${exampleLinuxMahjongWorkspace}/.worktrees/worker-1 is ready.`
        }
      ],
      stewardMessages: [
        {
          ...dashboard.stewardMessages[0],
          workspacePath: currentOwnerAgentFleetWorkspace,
          body: `Check ${exampleOwnerMahjongWorkspace} and ${exampleLinuxMahjongWorkspace}.`
        }
      ],
      worktreeAssignments: [
        {
          ...dashboard.worktreeAssignments[0],
          repositoryPath: currentOwnerAgentFleetWorkspace,
          worktreePath: `${exampleLinuxMahjongWorkspace}/.worktrees/worker-1`
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(genericHomeDashboard)));

    try {
      render(<App />);

      expect(await screen.findByText("Check ~/code/project/mahjong and ~/work/mahjong.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: "Goals" }));
      expect((await screen.findAllByText("~/code/project/mahjong")).length).toBeGreaterThan(0);
      expect(screen.getByText("Review ~/work/mahjong before dispatch.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: "Recovery" }));
      expect(screen.getAllByText("~/code/project/agent-fleet").length).toBeGreaterThan(0);
      expect(screen.getAllByText("~/work/mahjong/.worktrees/worker-1").length).toBeGreaterThan(0);
      expect(screen.queryByText((text) => text.includes(exampleOwnerMahjongWorkspace))).not.toBeInTheDocument();
      expect(screen.queryByText((text) => text.includes(exampleLinuxMahjongWorkspace))).not.toBeInTheDocument();
      expect(screen.queryByText((text) => text.includes(currentOwnerAgentFleetWorkspace))).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders persisted Steward chat messages and sends owner messages with context", async () => {
    const refreshedDashboard = {
      ...dashboard,
      stewardMessages: [
        ...dashboard.stewardMessages,
        {
          id: "message-3",
          role: "owner",
          projectName: "mahjong",
          workspacePath: "/workspaces/mahjong",
          goalId: null,
          body: "Use the external Mahjong workspace.",
          createdAt: "2026-04-26T00:03:00.000Z"
        }
      ]
    };
    let currentDashboard: unknown = dashboard;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/dashboard") {
        return Promise.resolve(jsonResponse(currentDashboard));
      }

      if (url === "/api/conversations") {
        return Promise.resolve(notFoundResponse());
      }

      if (url === "/api/steward/messages" && method === "POST") {
        currentDashboard = refreshedDashboard;
        return Promise.resolve(
          jsonResponse({
            ownerMessage: refreshedDashboard.stewardMessages[2],
            stewardMessage: {
              id: "message-4",
              role: "steward",
              projectName: "mahjong",
              workspacePath: "/workspaces/mahjong",
              goalId: null,
              body: "Acknowledged.",
              createdAt: "2026-04-26T00:03:10.000Z"
            }
          })
        );
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: "Steward Chat" })).toBeInTheDocument();
    expect(screen.getByText("Please keep Worker execution durable.")).toBeInTheDocument();
    expect(screen.getByText("I will record the decision trail before dispatching work.")).toBeInTheDocument();
    expect(screen.queryByText("WORKER_PROTOCOL: spawned process details and tool chatter")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Project"), "mahjong");
    await user.type(screen.getByLabelText("Target directory"), "/workspaces/mahjong");
    await user.type(screen.getByLabelText("Message Steward"), "Use the external Mahjong workspace.");
    await user.click(screen.getByRole("button", { name: "Send to Steward" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/steward/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "Use the external Mahjong workspace.",
          projectName: "mahjong",
          workspacePath: "/workspaces/mahjong"
        })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard");
    expect(await screen.findByText("Use the external Mahjong workspace.")).toBeInTheDocument();
  });

  it("loads Steward conversation history and sends web chat through the selected conversation", async () => {
    const conversation = {
      id: "conversation-1",
      title: "Mahjong recovery",
      projectName: "mahjong",
      workspacePath: exampleOwnerMahjongWorkspace,
      goalId: "goal-1",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:04:00.000Z"
    };
    const conversationMessages = [
      {
        id: "conversation-message-1",
        role: "owner",
        projectName: "mahjong",
        workspacePath: exampleOwnerMahjongWorkspace,
        goalId: "goal-1",
        body: `Show me recovery for ${exampleOwnerMahjongWorkspace}.`,
        createdAt: "2026-04-26T00:02:00.000Z"
      },
      {
        id: "conversation-message-2",
        role: "steward",
        projectName: "mahjong",
        workspacePath: exampleOwnerMahjongWorkspace,
        goalId: "goal-1",
        body: `Recovery is current for ${exampleOwnerMahjongWorkspace}.`,
        createdAt: "2026-04-26T00:02:10.000Z"
      }
    ];
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/dashboard") {
        return Promise.resolve(jsonResponse(dashboard));
      }

      if (url === "/api/conversations" && method === "GET") {
        return Promise.resolve(jsonResponse({ conversations: [conversation] }));
      }

      if (url === "/api/conversations/conversation-1/messages" && method === "GET") {
        return Promise.resolve(jsonResponse({ messages: conversationMessages }));
      }

      if (url === "/api/conversations/conversation-1/messages" && method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ownerMessage: {
              ...conversationMessages[0],
              id: "conversation-message-3",
              body: "Use the external Mahjong workspace."
            },
            stewardMessage: {
              ...conversationMessages[1],
              id: "conversation-message-4",
              body: "Acknowledged."
            }
          })
        );
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByLabelText("Conversation")).toHaveDisplayValue("Mahjong recovery - ~/code/project/mahjong");
    expect(screen.getByText("Show me recovery for ~/code/project/mahjong.")).toBeInTheDocument();
    expect(screen.queryByText((text) => text.includes(exampleOwnerMahjongWorkspace))).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Project"), "mahjong");
    await user.type(screen.getByLabelText("Target directory"), "/workspaces/mahjong");
    await user.type(screen.getByLabelText("Message Steward"), "Use the external Mahjong workspace.");
    await user.click(screen.getByRole("button", { name: "Send to Steward" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/conversation-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "Use the external Mahjong workspace.",
          projectName: "mahjong",
          workspacePath: "/workspaces/mahjong"
        })
      })
    );
    expect(fetchMock).not.toHaveBeenCalledWith("/api/steward/messages", expect.anything());
  });

  it("falls back to the legacy Steward message endpoint when conversations are unavailable", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/dashboard") {
        return Promise.resolve(jsonResponse(dashboard));
      }

      if (url === "/api/conversations") {
        return Promise.resolve(notFoundResponse());
      }

      if (url === "/api/steward/messages" && method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ownerMessage: dashboard.stewardMessages[0],
            stewardMessage: dashboard.stewardMessages[1]
          })
        );
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Project"), "mahjong");
    await user.type(screen.getByLabelText("Target directory"), "/workspaces/mahjong");
    await user.type(screen.getByLabelText("Message Steward"), "Check status.");
    await user.click(screen.getByRole("button", { name: "Send to Steward" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/conversations", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/steward/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "Check status.",
          projectName: "mahjong",
          workspacePath: "/workspaces/mahjong"
        })
      })
    );
  });

  it("requires a target directory before sending a Steward chat message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...dashboard, goals: [], stewardMessages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Message Steward"), "Start implementation without a workspace.");
    await user.click(screen.getByRole("button", { name: "Send to Steward" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Target directory is required");
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/(steward\/messages|conversations\/.+\/messages)/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sends a correction for a Steward decision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(dashboard))
      .mockResolvedValueOnce(jsonResponse({ id: "correction-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...dashboard,
          corrections: [
            {
              id: "correction-1",
              decisionId: "decision-1",
              body: "Escalate irreversible merge decisions to me.",
              createdBy: "human",
              createdAt: "2026-04-26T00:00:00.000Z"
            }
          ]
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Inbox" }));

    await user.type(await screen.findByLabelText("Correction for Start Worker Agent for goal"), "Escalate irreversible merge decisions to me.");
    await user.click(screen.getByRole("button", { name: "Send correction" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/decisions/decision-1/corrections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "Escalate irreversible merge decisions to me."
        })
      })
    );
  });
});
