import { join } from "node:path";

export interface PlanWorktreeInput {
  projectName: string;
  repositoryPath: string;
  worktreeRoot: string;
  goalTitle: string;
  workerSessionId: string;
}

export interface PlannedWorktree {
  branchName: string;
  path: string;
  command: string;
}

export function planWorktree(input: PlanWorktreeInput): PlannedWorktree {
  const projectSlug = slug(input.projectName);
  const workerSlug = slug(input.workerSessionId);
  const goalSlug = slug(input.goalTitle);
  const worktreeName = `${workerSlug}-${goalSlug}`;
  const path = join(input.worktreeRoot, worktreeName);
  const branchName = `${projectSlug}/${worktreeName}`;

  return {
    branchName,
    path,
    command: `git worktree add ${path} -b ${branchName}`
  };
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, "-")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized === "" ? "untitled" : normalized;
}
