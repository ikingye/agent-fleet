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
      defaultRepositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
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
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        workerSessionId: dashboard.workerSessions[0].id,
        repositoryPath: "/repo/agent-fleet",
        worktreePath: `/repo/agent-fleet/.worktrees/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        branchName: `agent-fleet/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        status: "planned"
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

  it("updates Worker session lifecycle status through the API", async () => {
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
          title: "Supervise Worker sessions",
          body: "Keep Worker lifecycle status durable."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const workerSessionId = dashboard.workerSessions[0].id;

      const statusResponse = await app.inject({
        method: "POST",
        url: `/api/worker-sessions/${workerSessionId}/status`,
        payload: {
          status: "completed",
          lastOutput: "Worker finished npm run check"
        }
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        workerSession: {
          id: workerSessionId,
          status: "completed",
          lastOutput: "Worker finished npm run check"
        }
      });

      const updated = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      expect(updated.workerSessions[0]).toMatchObject({
        id: workerSessionId,
        status: "completed",
        lastOutput: "Worker finished npm run check"
      });
      expect(updated.events.map((event: { type: string }) => event.type)).toContain("worker.status.updated");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid Worker session lifecycle status updates", async () => {
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
          title: "Validate lifecycle updates",
          body: "Reject unknown Worker status values."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const workerSessionId = dashboard.workerSessions[0].id;

      const statusResponse = await app.inject({
        method: "POST",
        url: `/api/worker-sessions/${workerSessionId}/status`,
        payload: {
          status: "stale",
          lastOutput: "not a valid durable status"
        }
      });

      expect(statusResponse.statusCode).toBe(400);
      expect(statusResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "status must be one of: starting, running, paused, completed, failed"
      });
    } finally {
      await app.close();
    }
  });

  it("registers a remote execution node and exposes it on the dashboard", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "mac-mini-builder",
          kind: "remote",
          status: "unknown",
          sshHost: "worker@mac-mini.local",
          workRoot: "/Users/worker/agent-fleet",
          proxyUrl: "http://127.0.0.1:1080"
        }
      });

      expect(nodeResponse.statusCode).toBe(200);
      expect(nodeResponse.json()).toMatchObject({
        name: "mac-mini-builder",
        kind: "remote",
        status: "unknown",
        sshHost: "worker@mac-mini.local",
        workRoot: "/Users/worker/agent-fleet",
        proxyUrl: "http://127.0.0.1:1080"
      });

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });
      const dashboard = dashboardResponse.json();

      expect(dashboard.executionNodes).toHaveLength(1);
      expect(dashboard.executionNodes[0]).toMatchObject({
        name: "mac-mini-builder",
        kind: "remote"
      });
      expect(dashboard.events.map((event: { type: string }) => event.type)).toContain("execution_node.registered");
    } finally {
      await app.close();
    }
  });

  it("updates an execution node by name without creating dashboard duplicates", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const createdResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "linux-builder",
          kind: "remote",
          status: "unknown",
          sshHost: "worker@linux-builder.internal",
          workRoot: "/srv/agent-fleet",
          proxyUrl: null
        }
      });
      const created = createdResponse.json();

      const updatedResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "linux-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@linux-builder.internal",
          workRoot: "/srv/agent-fleet",
          proxyUrl: "http://127.0.0.1:1080"
        }
      });
      const updated = updatedResponse.json();

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(createdResponse.statusCode).toBe(200);
      expect(updatedResponse.statusCode).toBe(200);
      expect(updated.id).toBe(created.id);
      expect(updated).toMatchObject({
        status: "ready",
        proxyUrl: "http://127.0.0.1:1080"
      });
      expect(dashboard.executionNodes).toHaveLength(1);
      expect(dashboard.events.map((event: { type: string }) => event.type)).toEqual([
        "execution_node.registered",
        "execution_node.updated"
      ]);
    } finally {
      await app.close();
    }
  });

  it("rejects ready remote execution nodes that are missing required readiness facts", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "broken-builder",
          kind: "remote",
          status: "ready",
          sshHost: null,
          workRoot: "relative/work",
          proxyUrl: null
        }
      });

      expect(nodeResponse.statusCode).toBe(400);
      expect(nodeResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "Remote execution node is not ready: ssh host is required; work root must be an absolute path"
      });
    } finally {
      await app.close();
    }
  });
});
