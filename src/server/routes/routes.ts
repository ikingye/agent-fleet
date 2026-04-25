import type { FastifyInstance } from "fastify";
import { openDatabase } from "../db/database.js";
import { GitHubClient } from "../github/githubClient.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { QualityGate } from "../quality/qualityGate.js";
import { RepositoryStore } from "../repositories/repositoryStore.js";
import { ReviewGate } from "../review/reviewGate.js";
import { CodexAdapter } from "../services/codexAdapter.js";
import { createCommandRunner } from "../services/commandRunner.js";
import { createWorktree, mergeToMain } from "../services/worktreeManager.js";

export interface RouteOptions {
  databasePath: string;
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

export async function registerRoutes(app: FastifyInstance, options: RouteOptions) {
  const db = openDatabase(options.databasePath);
  const store = new RepositoryStore(db.sql);
  const runner = createCommandRunner();
  const github = new GitHubClient(runner);
  const codexAdapter = new CodexAdapter(runner);
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

  app.addHook("onClose", async () => {
    db.close();
  });

  app.get("/api/dashboard", async () => {
    return {
      repositories: store.listRepositories(),
      tasks: store.listTasks()
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
    return { ran: await orchestrator.runNext() };
  });
}
