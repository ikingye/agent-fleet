import cors from "@fastify/cors";
import fastify from "fastify";
import { join } from "node:path";
import type { ExecutionNode, StewardCheckpointReason, WorkerSessionStatus } from "../../shared/types.js";
import { evaluateRemoteNodeReadiness } from "../remote/remoteNodeReadiness.js";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { buildStewardRecoveryReport } from "../steward/recoveryRuntime.js";
import { StewardRuntime } from "../steward/stewardRuntime.js";
import { createNodeWorktreeRunner } from "../worktrees/nodeWorktreeRunner.js";
import type { MaterializeWorktreeRunner } from "../worktrees/worktreeManager.js";
import { CommandWorkerAdapter, type WorkerAdapter } from "../workers/commandWorkerAdapter.js";

export interface CreateAppOptions {
  statePath?: string;
  workerCommand?: string;
  defaultWorkerCwd?: string;
  defaultRepositoryPath?: string;
  worktreeRoot?: string;
  materializeWorktrees?: boolean;
  worktreeRunner?: MaterializeWorktreeRunner;
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

function optionalString(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string or null`);
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalLastOutput(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("lastOutput must be a string when provided");
  }

  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings`);
  }

  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function requireWorkerSessionStatus(value: unknown): WorkerSessionStatus {
  if (
    value === "starting" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error("status must be one of: starting, running, paused, completed, failed");
}

function requireStewardCheckpointReason(value: unknown): StewardCheckpointReason {
  if (
    value === "dispatch" ||
    value === "correction" ||
    value === "recovery" ||
    value === "crash" ||
    value === "manual"
  ) {
    return value;
  }

  throw new Error("reason must be one of: dispatch, correction, recovery, crash, manual");
}

function requireExecutionNodeKind(value: unknown): ExecutionNode["kind"] {
  if (value === "local" || value === "remote") {
    return value;
  }

  throw new Error("kind must be one of: local, remote");
}

function requireExecutionNodeStatus(value: unknown): ExecutionNode["status"] {
  if (value === "ready" || value === "offline" || value === "unknown") {
    return value;
  }

  throw new Error("status must be one of: ready, offline, unknown");
}

function parseExecutionNodeInput(body: Record<string, unknown>): Omit<ExecutionNode, "id" | "createdAt" | "updatedAt"> {
  return {
    name: requireString(body.name, "name"),
    kind: requireExecutionNodeKind(body.kind),
    status: requireExecutionNodeStatus(body.status),
    sshHost: optionalString(body.sshHost, "sshHost"),
    workRoot: requireString(body.workRoot, "workRoot"),
    proxyUrl: optionalString(body.proxyUrl, "proxyUrl")
  };
}

function assertReadyRemoteNode(input: Omit<ExecutionNode, "id" | "createdAt" | "updatedAt">): void {
  if (input.kind !== "remote" || input.status !== "ready") {
    return;
  }

  const readiness = evaluateRemoteNodeReadiness({
    status: input.status,
    sshHost: input.sshHost,
    workRoot: input.workRoot,
    proxyUrl: input.proxyUrl,
    proxyRequired: false
  });

  if (!readiness.ready) {
    throw new Error(`Remote execution node is not ready: ${readiness.reasons.join("; ")}`);
  }
}

function defaultStatePath(): string {
  return join(process.cwd(), ".agent-fleet", "control-plane.json");
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = fastify({ logger: true });
  const store = await JsonControlPlaneStore.open(options.statePath ?? defaultStatePath());
  const workerAdapter = options.workerAdapter ?? new CommandWorkerAdapter(options.workerCommand ?? "codexyoloproxy");
  const defaultRepositoryPath = options.defaultRepositoryPath ?? process.cwd();
  const materializeWorktrees = options.materializeWorktrees ?? process.env.AGENT_FLEET_MATERIALIZE_WORKTREES === "true";
  const steward = new StewardRuntime({
    store,
    workerAdapter,
    defaultWorkerCwd: options.defaultWorkerCwd ?? process.cwd(),
    defaultRepositoryPath,
    worktreeRoot: options.worktreeRoot ?? join(defaultRepositoryPath, ".worktrees"),
    worktreeRunner:
      options.worktreeRunner ?? (materializeWorktrees ? createNodeWorktreeRunner(defaultRepositoryPath) : undefined)
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

  app.get("/api/recovery", async () => buildStewardRecoveryReport(await store.dashboard()));

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

  app.post("/api/worker-sessions/:id/status", async (request, reply) => {
    const params = request.params as { id?: string };
    const body = requestBody(request.body);

    try {
      const workerSession = await store.updateWorkerSessionStatus({
        workerSessionId: requireString(params.id, "id"),
        status: requireWorkerSessionStatus(body.status),
        lastOutput: optionalLastOutput(body.lastOutput)
      });

      return { workerSession };
    } catch (error) {
      if (error instanceof Error) {
        const statusCode = error.message.startsWith("Worker session not found:") ? 404 : 400;
        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post("/api/steward-checkpoints", async (request, reply) => {
    const body = requestBody(request.body);

    try {
      return await store.recordStewardCheckpoint({
        reason: requireStewardCheckpointReason(body.reason),
        summary: requireString(body.summary, "summary"),
        nextAction: requireString(body.nextAction, "nextAction"),
        goalIds: stringArray(body.goalIds, "goalIds"),
        workerSessionIds: stringArray(body.workerSessionIds, "workerSessionIds")
      });
    } catch (error) {
      if (error instanceof Error) {
        const statusCode =
          error.message.startsWith("Goal not found:") || error.message.startsWith("Worker session not found:")
            ? 404
            : 400;
        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post("/api/execution-nodes", async (request, reply) => {
    const body = requestBody(request.body);
    let input: Omit<ExecutionNode, "id" | "createdAt" | "updatedAt">;

    try {
      input = parseExecutionNodeInput(body);
      assertReadyRemoteNode(input);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: "Bad Request",
          message: error.message
        });
      }

      throw error;
    }

    return store.upsertExecutionNode(input);
  });

  return app;
}
