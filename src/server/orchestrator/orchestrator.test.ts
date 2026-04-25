import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { RepositoryStore } from "../repositories/repositoryStore.js";
import type { AgentAdapter, AgentRunResult } from "../services/agentAdapter.js";
import type { CreatedWorktree, CreateWorktreeInput } from "../services/worktreeManager.js";
import type { QualityGateResult } from "../quality/qualityGate.js";
import type { ReviewGateResult } from "../review/reviewGate.js";
import { Orchestrator } from "./orchestrator.js";

class StubWorktreeManager {
  async createWorktree(input: CreateWorktreeInput): Promise<CreatedWorktree> {
    return {
      repositoryId: input.repositoryId,
      taskId: input.taskId,
      path: join(input.repositoryRoot, ".worktrees", input.taskId),
      branch: `agent-fleet/${input.taskId}`,
      baseCommit: "base-commit"
    } as CreatedWorktree & { taskId: string };
  }

  async mergeToMain(): Promise<void> {}
}

class StubAgentAdapter implements AgentAdapter {
  readonly kind = "codex";

  async detect(): Promise<{ available: boolean; version: string | null; message: string }> {
    return { available: true, version: "codex 1.0.0", message: "available" };
  }

  async start(input: {
    taskId: string;
    worktreePath: string;
    prompt: string;
    logPath: string;
  }): Promise<AgentRunResult> {
    return {
      kind: "codex",
      status: "succeeded",
      output: "done",
      logPath: input.logPath
    };
  }
}

class StubQualityGate {
  async run(): Promise<QualityGateResult> {
    return { passed: true, checks: [] };
  }
}

class StubReviewGate {
  async run(): Promise<ReviewGateResult> {
    return { passed: true, summary: "APPROVED" };
  }
}

describe("Orchestrator", () => {
  it("runs one queued task through pushed state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-orchestrator-"));
    const dbPath = join(dir, "state.sqlite");
    const db = openDatabase(dbPath);

    try {
      const store = new RepositoryStore(db.sql);
      const project = store.createProject("agent-fleet");
      const repository = store.createRepository({
        projectId: project.id,
        name: "agent-fleet",
        rootPath: dir,
        remoteUrl: "https://github.com/ikingye/agent-fleet",
        mainBranch: "main"
      });
      const task = store.createTask({
        repositoryId: repository.id,
        title: "Add autonomous orchestrator",
        goal: "Move a queued task through the agent, gates, merge, and push states.",
        source: "local",
        sourceUrl: null
      });

      const orchestrator = new Orchestrator({
        store,
        worktreeManager: new StubWorktreeManager(),
        adapter: new StubAgentAdapter(),
        qualityGate: new StubQualityGate(),
        reviewGate: new StubReviewGate()
      });

      const ran = await orchestrator.runNext();

      expect(ran).toBe(true);
      expect(store.getTask(task.id)?.state).toBe("pushed");
      expect(store.listTaskEvents(task.id).map((event) => event.state)).toContain("agent_running");
      expect(store.listTaskEvents(task.id).map((event) => event.state)).toContain("pushed");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
