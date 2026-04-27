import cors from "@fastify/cors";
import fastify from "fastify";
import { join } from "node:path";
import type {
  DashboardData,
  ExecutionNode,
  GithubDeployKeyLeaseStatus,
  StewardCheckpointReason,
  WorkerSessionStatus
} from "../../shared/types.js";
import { runRemoteNodeOnboarding } from "../remote/remoteNodeOnboarding.js";
import { probeRemoteExecutionNode, type RemoteCommandRunner } from "../remote/remoteNodeProbe.js";
import {
  LocalGithubDeployKeyLeaseResolver,
  type GithubDeployKeyLeaseResolver
} from "../remote/githubDeployKeyLeaseResolver.js";
import {
  createWebhookConnectorHandler,
  WebhookConnectorError,
  type WebhookConnectorConfig
} from "../connectors/webhookConnector.js";
import { evaluateRemoteNodeReadiness } from "../remote/remoteNodeReadiness.js";
import { normalizeRemoteWorkRoot } from "../remote/remotePaths.js";
import {
  GitRemoteWorkspaceProvisioner,
  type RemoteWorkspaceProvisioner
} from "../remote/remoteWorkspaceProvisioner.js";
import { RemoteGithubDeployKeyProvisioner } from "../remote/remoteKeyProvisioner.js";
import { probeRemoteWorkerPid } from "../remote/remoteWorkerProbe.js";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { buildStewardRecoveryReport } from "../steward/recoveryRuntime.js";
import { ConversationService, type ConversationOwnerMessageInput } from "../steward/conversationService.js";
import { createDashboardWorkerProcessProbe } from "../steward/remoteSupervisorRuntime.js";
import { maintainGithubDeployKeyLeases } from "../steward/githubDeployKeyLeaseMaintenance.js";
import { runStewardAutonomyTick } from "../steward/stewardAutonomyRuntime.js";
import { StewardMessageLoop } from "../steward/stewardMessageLoop.js";
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
  githubDeployKeyLeaseResolver?: GithubDeployKeyLeaseResolver;
  remoteGithubDeployKeyProvisioner?: RemoteGithubDeployKeyProvisioner;
  githubDeployKeyLeaseTtlMs?: number;
  remoteSshWorkerRunner?: SshWorkerProcessRunner;
  remoteCommandRunner?: RemoteCommandRunner;
  workerProcessProbe?: Parameters<typeof reconcileWorkerSessions>[0]["probeProcess"];
  webhookConnectors?: WebhookConnectorConfig[];
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

function requireIsoDateString(value: unknown, name: string): string {
  const dateString = requireString(value, name);
  const timestamp = Date.parse(dateString);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid ISO date string`);
  }

  return dateString;
}

function optionalIsoDateString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireIsoDateString(value, name);
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

function optionalGithubDeployKeyLeaseStatus(value: unknown): GithubDeployKeyLeaseStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "active" || value === "released" || value === "stale") {
    return value;
  }

  throw new Error("status must be one of: active, released, stale");
}

function parseExecutionNodeInput(body: Record<string, unknown>): Omit<ExecutionNode, "id" | "createdAt" | "updatedAt"> {
  const kind = requireExecutionNodeKind(body.kind);

  return {
    name: requireString(body.name, "name"),
    kind,
    status: requireExecutionNodeStatus(body.status),
    sshHost: optionalString(body.sshHost, "sshHost"),
    workRoot:
      kind === "remote"
        ? normalizeRemoteWorkRoot(optionalString(body.workRoot, "workRoot"))
        : requireString(body.workRoot, "workRoot"),
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function requestRawBody(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }

  if (body === undefined || body === null) {
    return "";
  }

  return JSON.stringify(body);
}

function queryString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function githubDeployKeyLeaseErrorStatus(error: Error): 400 | 404 {
  return error.message.startsWith("Worker session not found:") ||
    error.message.startsWith("Execution node not found:") ||
    error.message.startsWith("GitHub deploy-key lease not found:")
    ? 404
    : 400;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function requireOwnerMessageBody(body: Record<string, unknown>): string {
  if (body.body !== undefined) {
    return requireString(body.body, "body");
  }

  if (body.text !== undefined) {
    return requireString(body.text, "text");
  }

  if (body.message !== undefined) {
    return requireString(body.message, "message");
  }

  return requireString(undefined, "body");
}

function projectNameFromEnvelope(body: Record<string, unknown>): string | null {
  const direct = optionalString(body.projectName, "projectName");
  if (direct !== null) {
    return direct;
  }

  if (typeof body.project === "string") {
    return requireString(body.project, "project");
  }

  const project = optionalRecord(body.project);
  if (project === null) {
    return null;
  }

  return optionalString(project.name, "project.name") ?? optionalString(project.projectName, "project.projectName");
}

function workspacePathFromEnvelope(body: Record<string, unknown>): string | null {
  const direct = optionalString(body.workspacePath, "workspacePath");
  if (direct !== null) {
    return direct;
  }

  const project = optionalRecord(body.project);
  if (project === null) {
    return null;
  }

  return optionalString(project.workspacePath, "project.workspacePath");
}

function externalMessageIdFromEnvelope(body: Record<string, unknown>): string | null {
  const direct =
    optionalString(body.externalMessageId, "externalMessageId") ?? optionalString(body.externalId, "externalId");
  if (direct !== null) {
    return direct;
  }

  const external = optionalRecord(body.external);
  if (external === null) {
    return null;
  }

  return optionalString(external.messageId, "external.messageId") ?? optionalString(external.id, "external.id");
}

function idempotencyKeyFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const value = headers["idempotency-key"] ?? headers["x-idempotency-key"];

  if (Array.isArray(value)) {
    return value[0] === undefined ? null : optionalString(value[0], "idempotency-key");
  }

  return optionalString(value, "idempotency-key");
}

function conversationMessageInput(
  conversationId: string,
  body: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>
): ConversationOwnerMessageInput {
  return {
    conversationId,
    transport: optionalString(body.transport, "transport") ?? "api",
    externalMessageId: externalMessageIdFromEnvelope(body),
    idempotencyKey: optionalString(body.idempotencyKey, "idempotencyKey") ?? idempotencyKeyFromHeaders(headers),
    projectName: projectNameFromEnvelope(body),
    workspacePath: workspacePathFromEnvelope(body),
    goalId: optionalString(body.goalId, "goalId"),
    body: requireOwnerMessageBody(body)
  };
}

function serverSentEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
  const remoteGithubDeployKeyProvisioner = options.remoteGithubDeployKeyProvisioner ?? new RemoteGithubDeployKeyProvisioner();
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
    githubDeployKeyLeaseResolver: options.githubDeployKeyLeaseResolver ?? new LocalGithubDeployKeyLeaseResolver(),
    remoteGithubDeployKeyProvisioner,
    githubDeployKeyLeaseTtlMs: options.githubDeployKeyLeaseTtlMs,
    defaultWorkerCwd: options.defaultWorkerCwd ?? process.cwd(),
    defaultRepositoryPath,
    worktreeRoot: options.worktreeRoot ?? join(defaultRepositoryPath, ".worktrees"),
    worktreeRunner:
      options.worktreeRunner ?? (materializeWorktrees ? createNodeWorktreeRunner(defaultRepositoryPath) : undefined)
  });
  const stewardMessageLoop = new StewardMessageLoop({ store, steward });
  const conversationService = new ConversationService({ store, messageLoop: stewardMessageLoop });
  const webhookConnectorHandler = createWebhookConnectorHandler({
    configs: options.webhookConnectors ?? [],
    conversationService
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

  app.get("/api/conversations", async (request, reply) => {
    const query = requestBody(request.query);

    try {
      const conversations = await conversationService.listConversations({
        projectName: optionalString(query.projectName, "projectName") ?? undefined,
        workspacePath: optionalString(query.workspacePath, "workspacePath") ?? undefined,
        transport: optionalString(query.transport, "transport") ?? undefined
      });

      return { conversations };
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

  app.post("/api/conversations/:conversationId/messages", async (request, reply) => {
    const params = request.params as { conversationId?: string };
    const body = requestBody(request.body);

    try {
      return await conversationService.acceptOwnerMessage(
        conversationMessageInput(requireString(params.conversationId, "conversationId"), body, request.headers)
      );
    } catch (error) {
      if (error instanceof Error) {
        const statusCode = error.message.startsWith("Goal not found:") ? 404 : 400;

        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.get("/api/conversations/:conversationId/messages", async (request, reply) => {
    const params = request.params as { conversationId?: string };

    try {
      const messages = await conversationService.listMessages(requireString(params.conversationId, "conversationId"));

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

  app.get("/api/events", async (_request, reply) => {
    const dashboard = await store.dashboard();
    const now = new Date().toISOString();
    const body =
      serverSentEvent("initial", {
        createdAt: now,
        events: dashboard.events.slice(-50)
      }) + serverSentEvent("heartbeat", { createdAt: now });

    return reply
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("connection", "keep-alive")
      .header("x-accel-buffering", "no")
      .send(body);
  });

  app.get("/api/connectors/webhook", async () => ({
    connectors: webhookConnectorHandler.publicConfigs()
  }));

  app.get("/api/connectors/webhook/:connectorId", async (request, reply) => {
    const params = request.params as { connectorId?: string };
    const query = requestBody(request.query);

    try {
      return await webhookConnectorHandler.verifyChallenge({
        connectorId: requireString(params.connectorId, "connectorId"),
        token: queryString(query.token),
        challenge: queryString(query.challenge ?? query.echostr)
      });
    } catch (error) {
      if (error instanceof WebhookConnectorError) {
        return reply.code(error.statusCode).send({
          error: webhookConnectorErrorName(error.statusCode),
          message: error.message
        });
      }

      throw error;
    }
  });

  await app.register(
    async (connectorApp) => {
      connectorApp.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
        done(null, body);
      });

      connectorApp.post("/:connectorId", async (request, reply) => {
        const params = request.params as { connectorId?: string };

        try {
          return await webhookConnectorHandler.receiveMessage({
            connectorId: requireString(params.connectorId, "connectorId"),
            rawBody: requestRawBody(request.body),
            headers: request.headers,
            query: requestBody(request.query)
          });
        } catch (error) {
          if (error instanceof WebhookConnectorError) {
            return reply.code(error.statusCode).send({
              error: webhookConnectorErrorName(error.statusCode),
              message: error.message
            });
          }

          throw error;
        }
      });
    },
    { prefix: "/api/connectors/webhook" }
  );

  app.post("/api/recovery/reconcile", async () => {
    const dashboard = await store.dashboard();
    const supervisedSessions = dashboard.workerSessions.filter(
      (session) => session.status === "starting" || session.status === "running"
    );

    const result = await reconcileWorkerSessions({
      dashboard,
      probeProcess: buildWorkerProcessProbe(dashboard, options),
      updateWorkerSessionStatus(input) {
        return store.updateWorkerSessionStatus(input);
      },
      updateGoalStatus(goalId, status) {
        return store.updateGoalStatus(goalId, status);
      }
    });

    if (result.updated > 0) {
      const checkedLabel = result.checked === 1 ? "Worker session" : "Worker sessions";
      await store.recordStewardCheckpoint({
        reason: "recovery",
        summary: `Recovery reconcile checked ${result.checked} ${checkedLabel} and updated ${result.updated}.`,
        nextAction:
          result.staleSessionIds.length === 0
            ? "Continue monitoring Worker sessions; related goals were updated for owner recovery."
            : `Review stale Worker sessions: ${result.staleSessionIds.join(
                ", "
              )}. Related goals were updated for owner recovery.`,
        goalIds: uniqueStrings(supervisedSessions.map((session) => session.goalId)),
        workerSessionIds: supervisedSessions.map((session) => session.id)
      });
    }
    await maintainGithubDeployKeyLeases({
      store,
      leaseTtlMs: options.githubDeployKeyLeaseTtlMs,
      remoteGithubDeployKeyProvisioner
    });

    return result;
  });

  app.post("/api/steward/autonomy/run", async () => {
    return runStewardAutonomyTick({
      store,
      probeProcess: buildWorkerProcessProbe(await store.dashboard(), options),
      githubDeployKeyLeaseTtlMs: options.githubDeployKeyLeaseTtlMs,
      remoteGithubDeployKeyProvisioner
    });
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

  app.get("/api/github-deploy-key-leases", async (request, reply) => {
    const query = requestBody(request.query);

    try {
      const projectName = optionalString(query.projectName, "projectName");
      const workspacePath = optionalString(query.workspacePath, "workspacePath");
      const repositoryUrl = optionalString(query.repositoryUrl, "repositoryUrl");
      const repositorySlug = optionalString(query.repositorySlug, "repositorySlug");
      const remoteNodeId = optionalString(query.remoteNodeId, "remoteNodeId");
      const status = optionalGithubDeployKeyLeaseStatus(query.status);
      const dashboard = await store.dashboard();
      const leases = dashboard.githubDeployKeyLeases.filter(
        (lease) =>
          (projectName === null || lease.projectName === projectName) &&
          (workspacePath === null || lease.workspacePath === workspacePath) &&
          (repositoryUrl === null || lease.repositoryUrl === repositoryUrl) &&
          (repositorySlug === null || lease.repositorySlug === repositorySlug) &&
          (remoteNodeId === null || lease.remoteNodeId === remoteNodeId) &&
          (status === undefined || lease.status === status)
      );

      return { leases };
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

  app.post("/api/github-deploy-key-leases/acquire", async (request, reply) => {
    const body = requestBody(request.body);

    try {
      const lease = await store.acquireGithubDeployKeyLease({
        projectName: requireString(body.projectName, "projectName"),
        workspacePath: requireString(body.workspacePath, "workspacePath"),
        repositoryUrl: requireString(body.repositoryUrl, "repositoryUrl"),
        repositorySlug: requireString(body.repositorySlug, "repositorySlug"),
        githubDeployKeyId: optionalString(body.githubDeployKeyId, "githubDeployKeyId"),
        publicKeyFingerprint: requireString(body.publicKeyFingerprint, "publicKeyFingerprint"),
        localPrivateKeyPath: requireString(body.localPrivateKeyPath, "localPrivateKeyPath"),
        remoteNodeId: requireString(body.remoteNodeId, "remoteNodeId"),
        remotePrivateKeyPath: requireString(body.remotePrivateKeyPath, "remotePrivateKeyPath"),
        workerSessionId: requireString(body.workerSessionId, "workerSessionId"),
        expiresAt: requireIsoDateString(body.expiresAt, "expiresAt"),
        now: optionalIsoDateString(body.now, "now")
      });

      return { lease };
    } catch (error) {
      if (error instanceof Error) {
        const statusCode = githubDeployKeyLeaseErrorStatus(error);

        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post("/api/github-deploy-key-leases/expire", async (request, reply) => {
    const body = requestBody(request.body);

    try {
      return await store.expireGithubDeployKeyLeases({
        now: optionalIsoDateString(body.now, "now")
      });
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

  app.post("/api/github-deploy-key-leases/:id/renew", async (request, reply) => {
    const params = request.params as { id?: string };
    const body = requestBody(request.body);

    try {
      const lease = await store.renewGithubDeployKeyLease({
        leaseId: requireString(params.id, "id"),
        workerSessionId: requireString(body.workerSessionId, "workerSessionId"),
        expiresAt: requireIsoDateString(body.expiresAt, "expiresAt"),
        now: optionalIsoDateString(body.now, "now")
      });

      return { lease };
    } catch (error) {
      if (error instanceof Error) {
        const statusCode = githubDeployKeyLeaseErrorStatus(error);

        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post("/api/github-deploy-key-leases/:id/release", async (request, reply) => {
    const params = request.params as { id?: string };
    const body = requestBody(request.body);

    try {
      const lease = await store.releaseGithubDeployKeyLease({
        leaseId: requireString(params.id, "id"),
        workerSessionId: requireString(body.workerSessionId, "workerSessionId"),
        now: optionalIsoDateString(body.now, "now")
      });

      return { lease };
    } catch (error) {
      if (error instanceof Error) {
        const statusCode = githubDeployKeyLeaseErrorStatus(error);

        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post("/api/steward/messages", async (request, reply) => {
    const body = requestBody(request.body);

    try {
      return await conversationService.acceptOwnerMessage({
        conversationId: optionalString(body.conversationId, "conversationId") ?? "steward",
        transport: optionalString(body.transport, "transport") ?? "web",
        externalMessageId: externalMessageIdFromEnvelope(body),
        idempotencyKey: optionalString(body.idempotencyKey, "idempotencyKey") ?? idempotencyKeyFromHeaders(request.headers),
        projectName: optionalString(body.projectName, "projectName"),
        workspacePath: optionalString(body.workspacePath, "workspacePath"),
        goalId: optionalString(body.goalId, "goalId"),
        body: requireString(body.body, "body")
      });
    } catch (error) {
      if (error instanceof Error) {
        const statusCode = error.message.startsWith("Goal not found:") ? 404 : 400;

        return reply.code(statusCode).send({
          error: statusCode === 404 ? "Not Found" : "Bad Request",
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
        conversationId: optionalString(query.conversationId, "conversationId") ?? undefined,
        projectName: optionalString(query.projectName, "projectName") ?? undefined,
        workspacePath: optionalString(query.workspacePath, "workspacePath") ?? undefined,
        transport: optionalString(query.transport, "transport") ?? undefined
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

  app.post("/api/execution-nodes/:id/probe", async (request, reply) => {
    const params = request.params as { id?: string };
    const nodeId = requireString(params.id, "id");
    const dashboard = await store.dashboard();
    const node = dashboard.executionNodes.find((item) => item.id === nodeId);

    if (node === undefined) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Execution node not found: ${nodeId}`
      });
    }

    try {
      return await probeRemoteExecutionNode({
        node,
        codexCommand: workerCommand,
        runner: options.remoteCommandRunner
      });
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

  app.post("/api/execution-nodes/:id/onboarding", async (request, reply) => {
    const params = request.params as { id?: string };
    const nodeId = requireString(params.id, "id");
    const dashboard = await store.dashboard();
    const node = dashboard.executionNodes.find((item) => item.id === nodeId);

    if (node === undefined) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Execution node not found: ${nodeId}`
      });
    }

    try {
      return await runRemoteNodeOnboarding({
        node,
        codexCommand: workerCommand,
        runner: options.remoteCommandRunner
      });
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

  return app;
}

function buildWorkerProcessProbe(
  dashboard: DashboardData,
  options: CreateAppOptions
): Parameters<typeof reconcileWorkerSessions>[0]["probeProcess"] {
  if (options.workerProcessProbe !== undefined) {
    return options.workerProcessProbe;
  }

  return createDashboardWorkerProcessProbe({
    dashboard,
    localProbe: probeLocalWorkerProcess,
    remotePidProbe(input) {
      return probeRemoteWorkerPid({
        ...input,
        runner: options.remoteCommandRunner
      });
    }
  });
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

function webhookConnectorErrorName(statusCode: WebhookConnectorError["statusCode"]): string {
  if (statusCode === 404) {
    return "Not Found";
  }

  if (statusCode === 401) {
    return "Unauthorized";
  }

  if (statusCode === 403) {
    return "Forbidden";
  }

  return "Bad Request";
}
