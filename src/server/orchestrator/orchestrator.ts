import { join } from "node:path";
import type { RepositoryStore } from "../repositories/repositoryStore.js";
import type { AgentAdapter } from "../services/agentAdapter.js";
import type {
  CreatedWorktree,
  CreateWorktreeInput,
  MergeToMainInput
} from "../services/worktreeManager.js";
import type { QualityGateInput, QualityGateResult } from "../quality/qualityGate.js";
import type { ReviewGateInput, ReviewGateResult } from "../review/reviewGate.js";

interface WorktreeManager {
  createWorktree(input: CreateWorktreeInput): Promise<CreatedWorktree>;
  mergeToMain(input: MergeToMainInput): Promise<void>;
}

interface QualityGateRunner {
  run(input: QualityGateInput): Promise<QualityGateResult>;
}

interface ReviewGateRunner {
  run(input: ReviewGateInput): Promise<ReviewGateResult>;
}

export interface OrchestratorDependencies {
  store: RepositoryStore;
  worktreeManager: WorktreeManager;
  adapter: AgentAdapter;
  qualityGate: QualityGateRunner;
  reviewGate: ReviewGateRunner;
}

export class Orchestrator {
  constructor(private deps: OrchestratorDependencies) {}

  async runNext(): Promise<boolean> {
    const task = this.deps.store.listQueuedTasks(1)[0];
    if (task === undefined) {
      return false;
    }

    const repository = this.deps.store.getRepository(task.repositoryId);
    if (repository === null) {
      throw new Error(`Repository not found: ${task.repositoryId}`);
    }

    const detection = await this.deps.adapter.detect();
    this.deps.store.transitionTask(task.id, "planned", "orchestrator", "Task planned", {
      agentKind: this.deps.adapter.kind,
      agentAvailable: detection.available,
      agentVersion: detection.version,
      agentMessage: detection.message
    });

    if (!detection.available) {
      this.deps.store.transitionTask(task.id, "failed", "orchestrator", "Agent unavailable", {
        agentKind: this.deps.adapter.kind,
        message: detection.message
      });
      return true;
    }

    const worktree = await this.deps.worktreeManager.createWorktree({
      repositoryId: repository.id,
      repositoryRoot: repository.rootPath,
      mainBranch: repository.mainBranch,
      taskId: task.id,
      taskTitle: task.title
    });

    this.deps.store.transitionTask(task.id, "worktree_ready", "orchestrator", "Worktree ready", {
      path: worktree.path,
      branch: worktree.branch,
      baseCommit: worktree.baseCommit
    });

    const logRoot = join(repository.rootPath, ".agent-fleet", "logs");
    const agentResult = await this.runWorker(task.id, task.title, task.goal, worktree.path, logRoot);

    if (agentResult.status === "failed") {
      this.deps.store.transitionTask(task.id, "failed", "worker", "Agent failed", {
        output: agentResult.output,
        logPath: agentResult.logPath
      });
      return true;
    }

    this.deps.store.transitionTask(task.id, "changes_ready", "worker", "Agent completed changes", {
      output: agentResult.output,
      logPath: agentResult.logPath
    });

    this.deps.store.transitionTask(task.id, "checks_running", "quality_gate", "Quality checks running");
    const qualityResult = await this.deps.qualityGate.run({
      taskId: task.id,
      repositoryRoot: worktree.path,
      commands: [
        { name: "typecheck", command: "npm run typecheck" },
        { name: "unit", command: "npm run test" }
      ]
    });

    if (!qualityResult.passed) {
      this.deps.store.transitionTask(task.id, "blocked", "quality_gate", "Quality gate failed", {
        checks: qualityResult.checks
      });
      return true;
    }

    this.deps.store.transitionTask(task.id, "reviewing", "reviewer", "Review gate running");
    const reviewResult = await this.deps.reviewGate.run({
      taskId: task.id,
      worktreePath: worktree.path,
      goal: task.goal,
      logRoot
    });

    if (!reviewResult.passed) {
      this.deps.store.transitionTask(task.id, "blocked", "reviewer", "Review gate failed", {
        summary: reviewResult.summary
      });
      return true;
    }

    this.deps.store.transitionTask(task.id, "reviewing", "reviewer", "Review gate passed", {
      summary: reviewResult.summary
    });
    this.deps.store.transitionTask(task.id, "merge_ready", "orchestrator", "Task ready to merge");

    await this.deps.worktreeManager.mergeToMain({
      repositoryRoot: repository.rootPath,
      mainBranch: repository.mainBranch,
      branch: worktree.branch,
      message: `merge: ${task.title}`
    });

    this.deps.store.transitionTask(task.id, "merged", "orchestrator", "Task merged", {
      branch: worktree.branch
    });
    this.deps.store.transitionTask(task.id, "pushed", "orchestrator", "Task pushed", {
      remoteUrl: repository.remoteUrl
    });

    return true;
  }

  private async runWorker(
    taskId: string,
    title: string,
    goal: string,
    worktreePath: string,
    logRoot: string
  ) {
    this.deps.store.transitionTask(taskId, "agent_running", "worker", "Agent running", {
      agentKind: this.deps.adapter.kind
    });

    return this.deps.adapter.start({
      taskId,
      worktreePath,
      prompt: this.buildPrompt(title, goal, worktreePath),
      logPath: join(logRoot, `${taskId}.log`)
    });
  }

  private buildPrompt(title: string, goal: string, worktreePath: string): string {
    return [
      "Task:",
      title,
      "",
      "Goal:",
      goal,
      "",
      `Work only in this worktree: ${worktreePath}`
    ].join("\n");
  }
}
