import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const dashboard = {
  goals: [
    {
      id: "goal-1",
      projectName: "agent-fleet",
      workspacePath: "/Users/yewang/code/project/agent-fleet",
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
      workspacePath: "/Users/yewang/code/project/agent-fleet",
      goalId: "goal-1",
      body: "Please keep Worker execution durable.",
      createdAt: "2026-04-26T00:00:30.000Z"
    },
    {
      id: "message-2",
      role: "steward",
      projectName: "agent-fleet",
      workspacePath: "/Users/yewang/code/project/agent-fleet",
      goalId: "goal-1",
      body: "I will record the decision trail before dispatching work.",
      createdAt: "2026-04-26T00:00:40.000Z"
    },
    {
      id: "message-3",
      role: "worker",
      projectName: "agent-fleet",
      workspacePath: "/Users/yewang/code/project/agent-fleet",
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
      sshHost: "worker@remote-build-1.internal",
      workRoot: "/srv/agent-fleet/worktrees",
      proxyUrl: "https://proxy.agent-fleet.internal",
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
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Goals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recovery" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resources" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Steward Intake" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Steward Chat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Key Decisions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Active Worker Summary" })).toBeInTheDocument();
    expect(screen.getAllByText("Start Worker Agent for goal").length).toBeGreaterThan(0);
    expect(screen.getByText("needs review")).toBeInTheDocument();
    expect(screen.getByText("owner double-check")).toBeInTheDocument();
    const decisionResource = screen.getByRole("group", { name: "Decision resource remote-build-1" });
    expect(within(decisionResource).getByText("remote-build-1")).toBeInTheDocument();
    expect(within(decisionResource).getByText("ready")).toBeInTheDocument();
    expect(within(decisionResource).getByText("2 slots")).toBeInTheDocument();
    expect(within(decisionResource).getByText("remote, linux, high-cpu")).toBeInTheDocument();
    expect(within(decisionResource).getByText("https://proxy.agent-fleet.internal")).toBeInTheDocument();
    expect(within(decisionResource).getByText("ready for remote verification")).toBeInTheDocument();
    expect(screen.getAllByText("1 running").length).toBeGreaterThan(0);
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

  it("makes external workspace context explicit in Steward intake", async () => {
    render(<App />);

    const targetDirectory = await screen.findByLabelText("Target directory");
    expect(targetDirectory).toBeRequired();
    expect(targetDirectory).toHaveAttribute("placeholder", "~/code/project/target");
    expect(screen.getByText("External workspace path required")).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Goal body")).toBeInTheDocument();
    expect(screen.getByLabelText("Message Steward")).toBeInTheDocument();
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
    render(<App />);

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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(dashboard))
      .mockResolvedValueOnce(jsonResponse({ result: { checked: 1, updated: 1 } }))
      .mockResolvedValueOnce(jsonResponse(autonomyDashboard))
      .mockResolvedValueOnce(jsonResponse({ checked: 1, updated: 0 }))
      .mockResolvedValueOnce(jsonResponse(reconciledDashboard));
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
    expect(fetchMock).toHaveBeenLastCalledWith("/api/dashboard");
  });

  it("shows supervision metrics for decisions, Worker sessions, and memory", async () => {
    render(<App />);

    expect(await screen.findByText("Human Review")).toBeInTheDocument();
    expect(screen.getByText("Running Workers")).toBeInTheDocument();
    expect(screen.getByText("Memory Items")).toBeInTheDocument();
  });

  it("renders worktree assignments and remote execution nodes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Recovery" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Worktrees" })).toBeInTheDocument();
    expect(screen.getByText("steward/dashboard-execution")).toBeInTheDocument();
    expect(screen.getByText("/worktrees/agent-fleet-dashboard-execution")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Resources" }));

    expect(screen.getByRole("heading", { level: 2, name: "Remote Nodes" })).toBeInTheDocument();
    const remoteNodesPanel = screen.getByRole("heading", { level: 2, name: "Remote Nodes" }).closest("details");
    expect(remoteNodesPanel).not.toBeNull();
    expect(within(remoteNodesPanel as HTMLElement).getByText("worker@remote-build-1.internal")).toBeInTheDocument();
    expect(within(remoteNodesPanel as HTMLElement).getByText("https://proxy.agent-fleet.internal")).toBeInTheDocument();
    expect(within(remoteNodesPanel as HTMLElement).getByText("remote, linux, high-cpu")).toBeInTheDocument();
    expect(within(remoteNodesPanel as HTMLElement).getByText("2")).toBeInTheDocument();
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
          sshHost: "worker@mac-mini.local",
          workRoot: "/Users/worker/agent-fleet",
          proxyUrl: "http://127.0.0.1:1080",
          tags: ["remote", "linux", "high-cpu"],
          capacity: 3,
          createdAt: "2026-04-26T00:03:00.000Z",
          updatedAt: "2026-04-26T00:03:00.000Z"
        }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(dashboard))
      .mockResolvedValueOnce(jsonResponse(refreshedDashboard.executionNodes[1]))
      .mockResolvedValueOnce(jsonResponse(refreshedDashboard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Resources" }));

    await user.type(await screen.findByLabelText("Remote node name"), "mac-mini-builder");
    await user.type(screen.getByLabelText("SSH host"), "worker@mac-mini.local");
    await user.type(screen.getByLabelText("Work root"), "/Users/worker/agent-fleet");
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
          sshHost: "worker@mac-mini.local",
          workRoot: "/Users/worker/agent-fleet",
          proxyUrl: "http://127.0.0.1:1080",
          tags: ["remote", "linux", "high-cpu"],
          capacity: 3
        })
      })
    );
    expect(fetchMock).toHaveBeenLastCalledWith("/api/dashboard");
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

  it("submits a new goal to the Steward Agent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...dashboard, goals: [], decisions: [], workerSessions: [] }))
      .mockResolvedValueOnce(jsonResponse(dashboard.goals[0]))
      .mockResolvedValueOnce(jsonResponse(dashboard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Project"), "agent-fleet");
    await user.type(screen.getByLabelText("Target directory"), "/Users/yewang/code/project/mahjong");
    await user.type(screen.getByLabelText("Goal title"), "Bootstrap agent-fleet");
    await user.type(screen.getByLabelText("Goal body"), "Build the Steward/Worker loop.");
    await user.click(screen.getByRole("button", { name: "Start Steward" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/goals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectName: "agent-fleet",
          workspacePath: "/Users/yewang/code/project/mahjong",
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
    expect(screen.getAllByText("~/code/project/agent-fleet").length).toBeGreaterThan(0);
  });

  it("displays owner home paths with a tilde without changing stored dashboard values", async () => {
    const homePathDashboard = {
      ...dashboard,
      goals: [
        {
          ...dashboard.goals[0],
          workspacePath: "/Users/yewang/code/project/mahjong"
        }
      ],
      workerSessions: [
        {
          ...dashboard.workerSessions[0],
          cwd: "/Users/yewang/code/project/mahjong/.worktrees/worker-1"
        }
      ],
      stewardMessages: [
        {
          ...dashboard.stewardMessages[0],
          workspacePath: "/Users/yewang/code/project/mahjong"
        }
      ],
      worktreeAssignments: [
        {
          ...dashboard.worktreeAssignments[0],
          repositoryPath: "/Users/yewang/code/project/mahjong",
          worktreePath: "/Users/yewang/code/project/mahjong/.worktrees/worker-1"
        }
      ],
      executionNodes: [
        {
          ...dashboard.executionNodes[0],
          workRoot: "/Users/yewang/code/project/mahjong/.worktrees"
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(homePathDashboard)));

    render(<App />);

    expect((await screen.findAllByText("~/code/project/mahjong")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: "Goals" }));
    expect(await screen.findAllByText("~/code/project/mahjong")).toHaveLength(3);
    await userEvent.click(screen.getByRole("tab", { name: "Recovery" }));
    expect(screen.getAllByText("~/code/project/mahjong/.worktrees/worker-1").length).toBeGreaterThanOrEqual(2);
    await userEvent.click(screen.getByRole("tab", { name: "Resources" }));
    expect(screen.getByText("~/code/project/mahjong/.worktrees")).toBeInTheDocument();
    expect(screen.queryByText("/Users/yewang/code/project/mahjong")).not.toBeInTheDocument();
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
          workspacePath: "/Users/yewang/code/project/mahjong",
          goalId: null,
          body: "Use the external Mahjong workspace.",
          createdAt: "2026-04-26T00:03:00.000Z"
        }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(dashboard))
      .mockResolvedValueOnce(
        jsonResponse({
          ownerMessage: refreshedDashboard.stewardMessages[2],
          stewardMessage: {
            id: "message-4",
            role: "steward",
            projectName: "mahjong",
            workspacePath: "/Users/yewang/code/project/mahjong",
            goalId: null,
            body: "Acknowledged.",
            createdAt: "2026-04-26T00:03:10.000Z"
          }
        })
      )
      .mockResolvedValueOnce(jsonResponse(refreshedDashboard));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: "Steward Chat" })).toBeInTheDocument();
    expect(screen.getByText("Please keep Worker execution durable.")).toBeInTheDocument();
    expect(screen.getByText("I will record the decision trail before dispatching work.")).toBeInTheDocument();
    expect(screen.queryByText("WORKER_PROTOCOL: spawned process details and tool chatter")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Project"), "mahjong");
    await user.type(screen.getByLabelText("Target directory"), "/Users/yewang/code/project/mahjong");
    await user.type(screen.getByLabelText("Message Steward"), "Use the external Mahjong workspace.");
    await user.click(screen.getByRole("button", { name: "Send to Steward" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/steward/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "Use the external Mahjong workspace.",
          projectName: "mahjong",
          workspacePath: "/Users/yewang/code/project/mahjong"
        })
      })
    );
    expect(fetchMock).toHaveBeenLastCalledWith("/api/dashboard");
    expect(await screen.findByText("Use the external Mahjong workspace.")).toBeInTheDocument();
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
