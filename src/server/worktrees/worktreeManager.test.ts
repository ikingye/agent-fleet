import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  materializeWorktree,
  planWorktree,
  type MaterializeWorktreeRunner,
  type PlannedWorktree
} from "./worktreeManager.js";

describe("planWorktree", () => {
  it("creates deterministic branch and path metadata for a Worker assignment", () => {
    const result = planWorktree({
      projectName: "agent-fleet",
      repositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      goalTitle: "Add remote execution",
      workerSessionId: "worker-123"
    });

    expect(result).toEqual({
      branchName: "agent-fleet/worker-123-add-remote-execution",
      path: "/repo/agent-fleet/.worktrees/worker-123-add-remote-execution",
      command:
        "git worktree add /repo/agent-fleet/.worktrees/worker-123-add-remote-execution -b agent-fleet/worker-123-add-remote-execution"
    });
  });

  it("normalizes unsafe names without producing empty branch segments", () => {
    const result = planWorktree({
      projectName: "Agent Fleet!",
      repositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      goalTitle: "修复 Google proxy & resume_id",
      workerSessionId: "worker_ABC"
    });

    expect(result.branchName).toBe("agent-fleet/worker-abc-google-proxy-resume-id");
    expect(result.path).toBe("/repo/agent-fleet/.worktrees/worker-abc-google-proxy-resume-id");
  });
});

describe("materializeWorktree", () => {
  const planned: PlannedWorktree = {
    branchName: "agent-fleet/worker-123-add-remote-execution",
    path: "/repo/agent-fleet/.worktrees/worker-123-add-remote-execution",
    command:
      "git worktree add /repo/agent-fleet/.worktrees/worker-123-add-remote-execution -b agent-fleet/worker-123-add-remote-execution"
  };

  it("creates the parent directory and runs git worktree add with argument arrays", async () => {
    const expectedArgs = ["worktree", "add", planned.path, "-b", planned.branchName];
    const createdDirs: string[] = [];
    const runCalls: Array<{ command: string; args: string[] }> = [];
    const runner: MaterializeWorktreeRunner = {
      pathExists: async () => false,
      ensureDir: async (path) => {
        createdDirs.push(path);
      },
      run: async (command, args) => {
        runCalls.push({ command, args });

        return {
          exitCode: 0,
          stdout: "created",
          stderr: ""
        };
      }
    };

    const result = await materializeWorktree(planned, runner);

    expect(createdDirs).toEqual([dirname(planned.path)]);
    expect(runCalls).toEqual([
      {
        command: "git",
        args: expectedArgs
      }
    ]);
    expect(result).toEqual({
      status: "created",
      path: planned.path,
      branchName: planned.branchName,
      command: {
        command: "git",
        args: expectedArgs
      },
      exitCode: 0,
      stdout: "created",
      stderr: ""
    });
  });

  it("returns already_exists without creating directories or running git when the path exists", async () => {
    const runner: MaterializeWorktreeRunner = {
      pathExists: async () => true,
      ensureDir: async () => {
        throw new Error("ensureDir should not run when the worktree already exists");
      },
      run: async () => {
        throw new Error("git should not run when the worktree already exists");
      }
    };

    const result = await materializeWorktree(planned, runner);

    expect(result).toEqual({
      status: "already_exists",
      path: planned.path,
      branchName: planned.branchName
    });
  });
});
