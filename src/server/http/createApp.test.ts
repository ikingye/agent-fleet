import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./createApp.js";
import type { WorkerAdapter } from "../workers/commandWorkerAdapter.js";

const fakeWorkerAdapter: WorkerAdapter = {
  kind: "codex",
  async start(input) {
    return {
      command: "codexyoloproxy",
      cwd: input.cwd,
      resumeId: "resume-api-test",
      pid: 4242,
      status: "running",
      initialOutput: "Worker started"
    };
  }
};

describe("API routes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-fleet-api-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a goal and exposes Steward decisions and Worker sessions on the dashboard", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const goalResponse = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          title: "Bootstrap agent-fleet",
          body: "Build a Steward Agent control plane."
        }
      });

      expect(goalResponse.statusCode).toBe(200);

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });
      const dashboard = dashboardResponse.json();

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboard.goals[0].status).toBe("running");
      expect(dashboard.decisions[0]).toMatchObject({
        title: "Start Worker Agent for goal",
        needsHumanReview: true
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        command: "codexyoloproxy",
        status: "running"
      });
    } finally {
      await app.close();
    }
  });

  it("records corrections through the API and returns updated memory", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          title: "Bootstrap agent-fleet",
          body: "Build a Steward Agent control plane."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const decisionId = dashboard.decisions[0].id;

      const correctionResponse = await app.inject({
        method: "POST",
        url: `/api/decisions/${decisionId}/corrections`,
        payload: {
          body: "Escalate irreversible merge decisions to me."
        }
      });

      expect(correctionResponse.statusCode).toBe(200);

      const updated = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      expect(updated.corrections[0]).toMatchObject({
        decisionId,
        body: "Escalate irreversible merge decisions to me."
      });
      expect(updated.memories[0]).toMatchObject({
        key: "correction:terminology"
      });
    } finally {
      await app.close();
    }
  });
});
