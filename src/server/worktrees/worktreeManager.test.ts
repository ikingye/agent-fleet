import { describe, expect, it } from "vitest";
import { planWorktree } from "./worktreeManager.js";

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
