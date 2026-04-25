import type { FastifyInstance } from "fastify";
import type { RemoteProxyMode } from "../../shared/types.js";
import { openDatabase } from "../db/database.js";
import { GitHubClient } from "../github/githubClient.js";
import { AutoDispatcher } from "../orchestrator/autoDispatcher.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { QualityGate } from "../quality/qualityGate.js";
import { RemoteHostProbe } from "../remote/remoteHostProbe.js";
import { RepositoryStore } from "../repositories/repositoryStore.js";
import { ReviewGate } from "../review/reviewGate.js";
import { CodexAdapter } from "../services/codexAdapter.js";
import { createCommandRunner, type CommandRunner } from "../services/commandRunner.js";
import { createWorktree, mergeToMain } from "../services/worktreeManager.js";

const DEFAULT_REMOTE_PROXY_URL = "http://127.0.0.1:1080";

export interface RouteOptions {
  databasePath: string;
  commandRunner?: CommandRunner;
  autoDispatch?: boolean;
  dispatchIntervalMs?: number;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function requestBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object") {
    return {};
  }

  return body as Record<string, unknown>;
}

function requireIssueNumber(value: unknown): number {
  const issueNumber = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("issueNumber must be a positive integer");
  }

  return issueNumber;
}

function requireProxyMode(value: unknown): RemoteProxyMode {
  const mode = requireString(value, "proxyMode");

  if (mode !== "direct" && mode !== "http_proxy" && mode !== "auto") {
    throw new Error("proxyMode must be direct, http_proxy, or auto");
  }

  return mode;
}

function optionalPort(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const port = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("localForwardPort must be a valid TCP port");
  }

  return port;
}

function normalizeProxyUrl(proxyMode: RemoteProxyMode, proxyUrl: string | null): string | null {
  if (proxyMode === "direct") {
    return null;
  }

  return proxyUrl ?? DEFAULT_REMOTE_PROXY_URL;
}

export async function registerRoutes(app: FastifyInstance, options: RouteOptions) {
  const db = openDatabase(options.databasePath);
  const store = new RepositoryStore(db.sql);
  const runner = options.commandRunner ?? createCommandRunner();
  const github = new GitHubClient(runner);
  const codexAdapter = new CodexAdapter(runner);
  const remoteHostProbe = new RemoteHostProbe(runner);
  const worktreeManager = {
    createWorktree: (input: Parameters<typeof createWorktree>[0]) => createWorktree(input, runner),
    mergeToMain: (input: Parameters<typeof mergeToMain>[0]) => mergeToMain(input, runner)
  };
  const qualityGate = new QualityGate(runner);
  const reviewGate = new ReviewGate(codexAdapter);
  const orchestrator = new Orchestrator({
    store,
    worktreeManager,
    adapter: codexAdapter,
    qualityGate,
    reviewGate
  });
  const dispatcher = new AutoDispatcher({
    orchestrator,
    intervalMs: options.dispatchIntervalMs ?? 5000,
    enabled: options.autoDispatch ?? false
  });

  if (options.autoDispatch === true) {
    store.recoverInterruptedTasks();
  }

  dispatcher.start();

  app.addHook("onClose", async () => {
    dispatcher.stop();
    db.close();
  });

  app.get("/api/dashboard", async () => {
    const tasks = store.listTasks();

    return {
      repositories: store.listRepositories(),
      tasks,
      taskEventsByTaskId: Object.fromEntries(tasks.map((task) => [task.id, store.listTaskEvents(task.id)])),
      dispatcher: dispatcher.status(),
      remoteHosts: store.listRemoteHosts()
    };
  });

  app.post("/api/repositories", async (request) => {
    const body = requestBody(request.body);
    const project = store.createProject(requireString(body.projectName, "projectName"));

    return store.createRepository({
      projectId: project.id,
      name: requireString(body.name, "name"),
      rootPath: requireString(body.rootPath, "rootPath"),
      remoteUrl: optionalString(body.remoteUrl),
      mainBranch: requireString(body.mainBranch, "mainBranch")
    });
  });

  app.post("/api/tasks", async (request) => {
    const body = requestBody(request.body);

    return store.createTask({
      repositoryId: requireString(body.repositoryId, "repositoryId"),
      title: requireString(body.title, "title"),
      goal: requireString(body.goal, "goal"),
      source: "local",
      sourceUrl: null
    });
  });

  app.post("/api/remote-hosts", async (request) => {
    const body = requestBody(request.body);
    const proxyMode = requireProxyMode(body.proxyMode);

    return store.createRemoteHost({
      name: requireString(body.name, "name"),
      sshHost: requireString(body.sshHost, "sshHost"),
      workRoot: requireString(body.workRoot, "workRoot"),
      proxyMode,
      proxyUrl: normalizeProxyUrl(proxyMode, optionalString(body.proxyUrl)),
      localForwardPort: optionalPort(body.localForwardPort)
    });
  });

  app.post("/api/remote-hosts/:id/check", async (request, reply) => {
    const params = request.params as { id?: string };
    const host = store.getRemoteHost(requireString(params.id, "id"));

    if (host === null) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Remote host not found",
        statusCode: 404
      });
    }

    return remoteHostProbe.check(host);
  });

  app.post("/api/github/issues/import", async (request) => {
    const body = requestBody(request.body);
    const issue = await github.getIssue(
      requireString(body.githubRepository, "githubRepository"),
      requireIssueNumber(body.issueNumber)
    );

    return store.createTask({
      repositoryId: requireString(body.repositoryId, "repositoryId"),
      title: issue.title,
      goal: issue.goal,
      source: "github_issue",
      sourceUrl: issue.url
    });
  });

  app.post("/api/orchestrator/run-once", async () => {
    return { ran: await dispatcher.runNow() };
  });
}
