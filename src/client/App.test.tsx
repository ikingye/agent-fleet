import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const dashboard = {
  goals: [
    {
      id: "goal-1",
      projectName: "agent-fleet",
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
      hostId: null,
      resumeId: "resume-1",
      status: "running",
      lastOutput: "started",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }
  ],
  corrections: [],
  memories: [],
  executionNodes: [],
  events: []
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

  it("renders the Steward control plane with decisions and Worker sessions", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "agent-fleet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Decision Ledger" })).toBeInTheDocument();
    expect(screen.getByText("Start Worker Agent for goal")).toBeInTheDocument();
    expect(screen.getByText("needs review")).toBeInTheDocument();
    expect(screen.getByText("codexyoloproxy")).toBeInTheDocument();
    expect(screen.getByText("pid 4242")).toBeInTheDocument();
    expect(screen.getByText("resume-1")).toBeInTheDocument();
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
    await user.type(screen.getByLabelText("Goal title"), "Bootstrap agent-fleet");
    await user.type(screen.getByLabelText("Goal body"), "Build the Steward/Worker loop.");
    await user.click(screen.getByRole("button", { name: "Start Steward" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/goals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectName: "agent-fleet",
          title: "Bootstrap agent-fleet",
          body: "Build the Steward/Worker loop."
        })
      })
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
