import { join } from "node:path";
import { createCommandRunner, type CommandResult, type CommandRunner } from "./commandRunner.js";

export interface CreateWorktreeInput {
  repositoryId: string;
  repositoryRoot: string;
  mainBranch: string;
  taskId: string;
  taskTitle: string;
}

export interface CreatedWorktree {
  repositoryId: string;
  branch: string;
  path: string;
  baseCommit: string;
}

export interface MergeToMainInput {
  repositoryRoot: string;
  mainBranch: string;
  branch: string;
  message: string;
}

export async function createWorktree(
  input: CreateWorktreeInput,
  runner: CommandRunner = createCommandRunner()
): Promise<CreatedWorktree> {
  const slug = slugify(input.taskTitle);
  const worktreeName = `${input.taskId}-${slug}`;
  const branch = `agent-fleet/${worktreeName}`;
  const worktreePath = join(input.repositoryRoot, ".worktrees", worktreeName);

  const status = await runner.run("git", ["status", "--porcelain"], { cwd: input.repositoryRoot });
  assertSuccess(status, "git status --porcelain");

  if (status.stdout.trim().length > 0) {
    throw new Error("Repository has uncommitted changes");
  }

  const revParse = await runner.run("git", ["rev-parse", "HEAD"], { cwd: input.repositoryRoot });
  assertSuccess(revParse, "git rev-parse HEAD");

  await assertRun(
    runner,
    "git",
    ["worktree", "add", "-b", branch, worktreePath, input.mainBranch],
    input.repositoryRoot
  );

  return {
    repositoryId: input.repositoryId,
    branch,
    path: worktreePath,
    baseCommit: revParse.stdout.trim()
  };
}

export async function mergeToMain(
  input: MergeToMainInput,
  runner: CommandRunner = createCommandRunner()
): Promise<void> {
  await assertRun(runner, "git", ["checkout", input.mainBranch], input.repositoryRoot);
  await assertRun(runner, "git", ["pull", "--ff-only", "origin", input.mainBranch], input.repositoryRoot);
  await assertRun(
    runner,
    "git",
    ["merge", "--no-ff", input.branch, "-m", input.message],
    input.repositoryRoot
  );
  await assertRun(runner, "git", ["push", "origin", input.mainBranch], input.repositoryRoot);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function assertRun(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string
): Promise<CommandResult> {
  const result = await runner.run(command, args, { cwd });
  assertSuccess(result, `${command} ${args.join(" ")}`);
  return result;
}

function assertSuccess(result: CommandResult, description: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${description} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }
}
