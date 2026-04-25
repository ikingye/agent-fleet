import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("API routes", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "agent-fleet-state-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("registers a repository, creates a local task, and returns it on the dashboard", async () => {
    const app = createApp({ databasePath: join(stateRoot, "state.sqlite") });

    try {
      const repositoryResponse = await app.inject({
        method: "POST",
        url: "/api/repositories",
        payload: {
          projectName: "Agent Fleet",
          name: "agent-fleet",
          rootPath: "/tmp/agent-fleet",
          remoteUrl: "https://github.com/example/agent-fleet.git",
          mainBranch: "main"
        }
      });

      expect(repositoryResponse.statusCode).toBe(200);
      const repository = repositoryResponse.json();

      const taskResponse = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          repositoryId: repository.id,
          title: "Add dashboard",
          goal: "Expose current task status"
        }
      });

      expect(taskResponse.statusCode).toBe(200);

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboardResponse.json().tasks).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("returns ran false when run-once has no queued task", async () => {
    const app = createApp({ databasePath: join(stateRoot, "state.sqlite") });

    try {
      const response = await app.inject({ method: "POST", url: "/api/orchestrator/run-once" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ran: false });
    } finally {
      await app.close();
    }
  });
});
