import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "../services/commandRunner.js";
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
      const task = taskResponse.json();

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboardResponse.json().tasks).toHaveLength(1);
      expect(dashboardResponse.json().taskEventsByTaskId[task.id].map((event: { message: string }) => event.message))
        .toContain("Task queued");
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

  it("creates remote hosts, shows them on the dashboard, and probes ssh proxy readiness", async () => {
    const runner: CommandRunner = {
      async run(_command, args) {
        const commandText = args.at(-1) ?? "";

        if (args.includes("-G")) {
          return {
            exitCode: 0,
            stdout: "remoteforward [127.0.0.1]:1080 [127.0.0.1]:1080\n",
            stderr: ""
          };
        }

        if (commandText === "uname -s") {
          return { exitCode: 0, stdout: "Linux\n", stderr: "" };
        }

        if (commandText.includes("command -v git")) {
          return { exitCode: 0, stdout: "/usr/bin/git\n/usr/bin/node\n/usr/local/bin/codex\n", stderr: "" };
        }

        if (commandText.includes("api.github.com") && !commandText.includes("HTTPS_PROXY=")) {
          return { exitCode: 28, stdout: "", stderr: "timeout" };
        }

        return { exitCode: 0, stdout: "HTTP/2 200\n", stderr: "" };
      }
    };
    const app = createApp({ databasePath: join(stateRoot, "state.sqlite"), commandRunner: runner });

    try {
      const hostResponse = await app.inject({
        method: "POST",
        url: "/api/remote-hosts",
        payload: {
          name: "remote-dev",
          sshHost: "remote-dev",
          workRoot: "/root/code/project",
          proxyMode: "auto",
          localForwardPort: 8788
        }
      });

      expect(hostResponse.statusCode).toBe(200);
      const host = hostResponse.json();
      expect(host.proxyUrl).toBe("http://127.0.0.1:1080");

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboardResponse.json().remoteHosts).toHaveLength(1);

      const checkResponse = await app.inject({
        method: "POST",
        url: `/api/remote-hosts/${host.id}/check`
      });

      expect(checkResponse.statusCode).toBe(200);
      expect(checkResponse.json().checks.map((check: { name: string; status: string }) => [check.name, check.status]))
        .toContainEqual(["github_proxy", "passed"]);
      expect(checkResponse.json().checks.map((check: { name: string; status: string }) => [check.name, check.status]))
        .toContainEqual(["github_direct", "warning"]);
    } finally {
      await app.close();
    }
  });
});
