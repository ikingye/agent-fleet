import { dirname, join } from "node:path";

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

export interface MaterializeWorktreeCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface MaterializeWorktreeRunner {
  pathExists(path: string): boolean | Promise<boolean>;
  ensureDir(path: string): void | Promise<void>;
  run(
    command: string,
    args: string[]
  ): MaterializeWorktreeCommandResult | Promise<MaterializeWorktreeCommandResult>;
}

export interface CreatedWorktreeResult extends MaterializeWorktreeCommandResult {
  status: "created";
  path: string;
  branchName: string;
  command: {
    command: "git";
    args: string[];
  };
}

export interface ExistingWorktreeResult {
  status: "already_exists";
  path: string;
  branchName: string;
}

export type MaterializeWorktreeResult = CreatedWorktreeResult | ExistingWorktreeResult;

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

export async function materializeWorktree(
  planned: PlannedWorktree,
  runner: MaterializeWorktreeRunner
): Promise<MaterializeWorktreeResult> {
  if (await runner.pathExists(planned.path)) {
    return {
      status: "already_exists",
      path: planned.path,
      branchName: planned.branchName
    };
  }

  const command = {
    command: "git" as const,
    args: ["worktree", "add", planned.path, "-b", planned.branchName]
  };

  await runner.ensureDir(dirname(planned.path));
  const result = await runner.run(command.command, command.args);

  return {
    status: "created",
    path: planned.path,
    branchName: planned.branchName,
    command,
    ...result
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
