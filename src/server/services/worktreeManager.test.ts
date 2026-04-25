import { describe, expect, it } from "vitest";
import type { CommandRunner, CommandResult } from "./commandRunner.js";
import { createWorktree } from "./worktreeManager.js";

describe("createWorktree", () => {
  it("creates a task worktree from the main branch", async () => {
    const calls: string[] = [];
    const runner: CommandRunner = {
      async run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
        calls.push(`${options.cwd}$ ${command} ${args.join(" ")}`);

        if (args.join(" ") === "status --porcelain") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }

        if (args.join(" ") === "rev-parse HEAD") {
          return { exitCode: 0, stdout: "abc123\n", stderr: "" };
        }

        return { exitCode: 0, stdout: "", stderr: "" };
      }
    };

    const worktree = await createWorktree(
      {
        repositoryId: "repo-1",
        repositoryRoot: "/repo",
        mainBranch: "main",
        taskId: "task-1",
        taskTitle: "Add API health"
      },
      runner
    );

    expect(worktree).toEqual({
      repositoryId: "repo-1",
      branch: "agent-fleet/task-1-add-api-health",
      path: "/repo/.worktrees/task-1-add-api-health",
      baseCommit: "abc123"
    });
    expect(calls).toContain(
      "/repo$ git worktree add -b agent-fleet/task-1-add-api-health /repo/.worktrees/task-1-add-api-health main"
    );
  });
});
