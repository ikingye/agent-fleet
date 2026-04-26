import cors from "@fastify/cors";
import fastify from "fastify";
import { join } from "node:path";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { StewardRuntime } from "../steward/stewardRuntime.js";
import { CommandWorkerAdapter, type WorkerAdapter } from "../workers/commandWorkerAdapter.js";

export interface CreateAppOptions {
  statePath?: string;
  workerCommand?: string;
  defaultWorkerCwd?: string;
  defaultRepositoryPath?: string;
  worktreeRoot?: string;
  workerAdapter?: WorkerAdapter;
}

function requestBody(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function defaultStatePath(): string {
  return join(process.cwd(), ".agent-fleet", "control-plane.json");
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = fastify({ logger: true });
  const store = await JsonControlPlaneStore.open(options.statePath ?? defaultStatePath());
  const workerAdapter = options.workerAdapter ?? new CommandWorkerAdapter(options.workerCommand ?? "codexyoloproxy");
  const defaultRepositoryPath = options.defaultRepositoryPath ?? process.cwd();
  const steward = new StewardRuntime({
    store,
    workerAdapter,
    defaultWorkerCwd: options.defaultWorkerCwd ?? process.cwd(),
    defaultRepositoryPath,
    worktreeRoot: options.worktreeRoot ?? join(defaultRepositoryPath, ".worktrees")
  });

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin));
    }
  });

  app.get("/api/health", async () => {
    return { ok: true, service: "agent-fleet" };
  });

  app.get("/api/dashboard", async () => store.dashboard());

  app.post("/api/goals", async (request) => {
    const body = requestBody(request.body);

    return steward.acceptGoal({
      projectName: requireString(body.projectName, "projectName"),
      title: requireString(body.title, "title"),
      body: requireString(body.body, "body")
    });
  });

  app.post("/api/decisions/:id/corrections", async (request) => {
    const params = request.params as { id?: string };
    const body = requestBody(request.body);

    return steward.correctDecision({
      decisionId: requireString(params.id, "id"),
      body: requireString(body.body, "body")
    });
  });

  return app;
}
