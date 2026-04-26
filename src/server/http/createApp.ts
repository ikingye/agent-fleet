import cors from "@fastify/cors";
import fastify from "fastify";
import { join } from "node:path";
import type { DashboardData, ExecutionNode, StewardCheckpointReason, WorkerSessionStatus } from "../../shared/types.js";
import { evaluateRemoteNodeReadiness } from "../remote/remoteNodeReadiness.js";
import {
  GitRemoteWorkspaceProvisioner,
  type RemoteWorkspaceProvisioner
} from "../remote/remoteWorkspaceProvisioner.js";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { buildStewardRecoveryReport } from "../steward/recoveryRuntime.js";
import {
  probeLocalWorkerProcess,
  reconcileWorkerSessions
} from "../steward/supervisorRuntime.js";
import { StewardRuntime } from "../steward/stewardRuntime.js";
import { createNodeWorktreeRunner } from "../worktrees/nodeWorktreeRunner.js";
import type { MaterializeWorktreeRunner } from "../worktrees/worktreeManager.js";
import {
  CommandWorkerAdapter,
  parseWorkerCommandArgs,
  type WorkerAdapter
} from "../workers/commandWorkerAdapter.js";
import { RemoteSshWorkerAdapter, type SshWorkerProcessRunner } from "../workers/sshWorkerAdapter.js";

export interface CreateAppOptions {
  statePath?: string;
  workerCommand?: string;
  workerArgs?: string[];
  defaultWorkerCwd?: string;
  defaultRepositoryPath?: string;
  worktreeRoot?: string;
  materializeWorktrees?: boolean;
  worktreeRunner?: MaterializeWorktreeRunner;
  workerAdapter?: WorkerAdapter;
  remoteWorkerAdapterFactory?: (node: ExecutionNode) => WorkerAdapter;
  remoteWorkspaceProvisioner?: RemoteWorkspaceProvisioner;
  remoteSshWorkerRunner?: SshWorkerProcessRunner;
  workerProcessProbe?: Parameters<typeof reconcileWorkerSessions>[0]["probeProcess"];
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

function optionalTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("tags must be an array of strings");
  }

  return [
    ...new Set(
      value
        .map((item, index) => requireString(item, `tags[${index}]`).toLowerCase())
        .filter((tag) => tag !== "")
    )
  ];
}

function optionalCapacity(value: unknown): number {
  if (value === undefined || value === null) {
    return 1;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error("capacity must be a positive number");
  }

  return Math.floor(value);
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
    proxyUrl: optionalString(body.proxyUrl, "proxyUrl"),
    tags: optionalTags(body.tags),
    capacity: optionalCapacity(body.capacity)
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

function buildDeterministicStewardResponse(
  dashboard: DashboardData,
  projectName: string | null,
  workspacePath: string | null
): string {
  const activeGoals = dashboard.goals.filter((goal) => {
    if (goal.status !== "queued" && goal.status !== "running" && goal.status !== "blocked") {
      return false;
    }

    if (projectName !== null && goal.projectName !== projectName) {
      return false;
    }

    if (workspacePath !== null && goal.workspacePath !== workspacePath) {
      return false;
    }

    return true;
  });
  const latestCheckpoint = [...dashboard.stewardCheckpoints].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
  )[0];
  const pieces = [
    workspacePath === null ? "No workspace is selected for this chat." : `Workspace: ${workspacePath}.`,
    `I see ${activeGoals.length} active ${activeGoals.length === 1 ? "goal" : "goals"}${
      projectName === null ? "" : ` for ${projectName}`
    }.`
  ];

  if (activeGoals.length > 0) {
    pieces.push(`Current active goal: ${activeGoals[0].title} (${activeGoals[0].status}).`);
  }

  if (latestCheckpoint !== undefined) {
    pieces.push(`Recovery next action: ${latestCheckpoint.nextAction}`);
  } else {
    pieces.push("Recovery next action: no checkpoint yet; use dashboard state before dispatching more Worker Agents.");
  }

  return pieces.join(" ");
}

function localWorkerDashboard(dashboard: DashboardData): DashboardData {
  return {
    ...dashboard,
    workerSessions: dashboard.workerSessions.filter((session) => session.hostId === null || session.hostId === "local")
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = fastify({ logger: true });
  const store = await JsonControlPlaneStore.open(options.statePath ?? defaultStatePath());
  const workerArgs = options.workerArgs ?? parseWorkerCommandArgs(process.env.AGENT_FLEET_WORKER_ARGS);
  const workerCommand = options.workerCommand ?? "codexyoloproxy";
  const workerAdapter =
    options.workerAdapter ?? new CommandWorkerAdapter(workerCommand, workerArgs);
  const defaultRepositoryPath = options.defaultRepositoryPath ?? process.cwd();
  const materializeWorktrees = options.materializeWorktrees ?? process.env.AGENT_FLEET_MATERIALIZE_WORKTREES === "true";
  const steward = new StewardRuntime({
    store,
    workerAdapter,
    remoteWorkerAdapterFactory:
      options.remoteWorkerAdapterFactory ??
      ((node) =>
        new RemoteSshWorkerAdapter({
          sshHost: node.sshHost ?? "",
          workerCommand,
          workerArgs,
          proxyEnv: buildRemoteProxyEnv(node.proxyUrl),
          runner: options.remoteSshWorkerRunner
        })),
    remoteWorkspaceProvisioner: options.remoteWorkspaceProvisioner ?? new GitRemoteWorkspaceProvisioner(),
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

  app.post("/api/recovery/reconcile", async () => {
    const localDashboard = localWorkerDashboard(await store.dashboard());

    return reconcileWorkerSessions({
      dashboard: localDashboard,
      probeProcess: options.workerProcessProbe ?? probeLocalWorkerProcess,
      updateWorkerSessionStatus(input) {
        return store.updateWorkerSessionStatus(input);
      }
    });
  });

  app.post("/api/steward/autonomy/run", async () => {
    const localDashboard = localWorkerDashboard(await store.dashboard());
    const supervisedSessions = localDashboard.workerSessions.filter(
      (session) => session.status === "starting" || session.status === "running"
    );
    const result = await reconcileWorkerSessions({
      dashboard: localDashboard,
      probeProcess: options.workerProcessProbe ?? probeLocalWorkerProcess,
      updateWorkerSessionStatus(input) {
        return store.updateWorkerSessionStatus(input);
      }
    });
    const checkedLabel = result.checked === 1 ? "Worker session" : "Worker sessions";
    const checkpoint = await store.recordStewardCheckpoint({
      reason: "manual",
      summary: `Autonomy reconcile checked ${result.checked} ${checkedLabel} and updated ${result.updated}.`,
      nextAction:
        result.staleSessionIds.length === 0
          ? "Continue monitoring Worker sessions; no new Worker Agent was dispatched."
          : `Review stale Worker sessions: ${result.staleSessionIds.join(", ")}. No new Worker Agent was dispatched.`,
      goalIds: uniqueStrings(supervisedSessions.map((session) => session.goalId)),
      workerSessionIds: supervisedSessions.map((session) => session.id)
    });

    return { result, checkpoint };
  });

  app.post("/api/goals", async (request) => {
    const body = requestBody(request.body);

    return steward.acceptGoal({
      projectName: requireString(body.projectName, "projectName"),
      workspacePath: requireString(body.workspacePath, "workspacePath"),
      title: requireString(body.title, "title"),
      body: requireString(body.body, "body")
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && error.message.includes("must be")) {
      return reply.code(400).send({
        error: "Bad Request",
        message: error.message
      });
    }

    throw error;
  });

  app.post("/api/steward/messages", async (request, reply) => {
    const body = requestBody(request.body);

    try {
      const dashboard = await store.dashboard();
      const goalId = optionalString(body.goalId, "goalId");
      const goal = goalId === null ? null : dashboard.goals.find((item) => item.id === goalId);

      if (goalId !== null && goal === undefined) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Goal not found: ${goalId}`
        });
      }

      const projectName = goal?.projectName ?? optionalString(body.projectName, "projectName");
      const workspacePath = goal?.workspacePath ?? optionalString(body.workspacePath, "workspacePath");
      const ownerMessage = await store.recordStewardMessage({
        role: "owner",
        projectName,
        workspacePath,
        goalId,
        body: requireString(body.body, "body")
      });
      const stewardDashboard = await store.dashboard();
      const stewardMessage = await store.recordStewardMessage({
        role: "steward",
        projectName,
        workspacePath,
        goalId,
        body: buildDeterministicStewardResponse(stewardDashboard, projectName, workspacePath)
      });

      return { ownerMessage, stewardMessage };
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.get("/api/steward/messages", async (request, reply) => {
    const query = requestBody(request.query);

    try {
      const messages = await store.listStewardMessages({
        projectName: optionalString(query.projectName, "projectName") ?? undefined,
        workspacePath: optionalString(query.workspacePath, "workspacePath") ?? undefined
      });

      return { messages };
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
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

function buildRemoteProxyEnv(proxyUrl: string | null): Readonly<Record<string, string>> {
  if (proxyUrl === null || proxyUrl.trim() === "") {
    return {};
  }

  const normalizedProxyUrl = proxyUrl.trim();

  return {
    ALL_PROXY: normalizedProxyUrl,
    HTTP_PROXY: normalizedProxyUrl,
    HTTPS_PROXY: normalizedProxyUrl,
    NO_PROXY: "localhost,127.0.0.1"
  };
}
