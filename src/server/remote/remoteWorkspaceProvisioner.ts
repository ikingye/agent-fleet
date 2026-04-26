import { spawn } from "node:child_process";
import { dirname } from "node:path/posix";
import type { ExecutionNode } from "../../shared/types.js";

export interface RemoteWorkspaceProvisionInput {
  node: ExecutionNode;
  localWorkspacePath: string;
  remoteWorkspacePath: string;
}

export interface RemoteWorkspaceProvisionResult {
  status: "prepared" | "blocked";
  summary: string;
  actions: string[];
}

export interface RemoteWorkspaceProvisioner {
  provision(input: RemoteWorkspaceProvisionInput): Promise<RemoteWorkspaceProvisionResult>;
}

export interface RemoteWorkspaceProvisionRunner {
  run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export class GitRemoteWorkspaceProvisioner implements RemoteWorkspaceProvisioner {
  constructor(private readonly runner: RemoteWorkspaceProvisionRunner = new SshRemoteWorkspaceProvisionRunner()) {}

  async provision(input: RemoteWorkspaceProvisionInput): Promise<RemoteWorkspaceProvisionResult> {
    const sshHost = input.node.sshHost?.trim();

    if (sshHost === undefined || sshHost === "") {
      return {
        status: "blocked",
        summary: "Remote workspace blocked: selected remote node has no SSH host.",
        actions: ["Skipped remote workspace provisioning because sshHost is missing"]
      };
    }

    const git = await inspectLocalGit(input.localWorkspacePath);
    const mkdir = await this.runner.run({
      sshHost,
      remoteScript: `mkdir -p ${shellQuote(input.remoteWorkspacePath)}`
    });

    if (mkdir.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Remote workspace blocked: failed to create remote cwd ${input.remoteWorkspacePath}.`,
        actions: ["Tried to ensure remote cwd exists", summarizeCommandOutput(mkdir)]
      };
    }

    if (git.status === "blocked") {
      return {
        status: "blocked",
        summary: git.summary,
        actions: ["Ensured remote cwd exists", git.summary]
      };
    }

    const provision = await this.runner.run({
      sshHost,
      remoteScript: buildGitProvisionScript({
        cwd: input.remoteWorkspacePath,
        originUrl: git.originUrl,
        branchName: git.branchName,
        commitSha: git.commitSha
      })
    });

    if (provision.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Remote workspace blocked: git provisioning failed for ${input.remoteWorkspacePath}.`,
        actions: ["Ensured remote cwd exists", "Tried git clone/fetch/checkout", summarizeCommandOutput(provision)]
      };
    }

    return {
      status: "prepared",
      summary: `Remote workspace prepared at ${input.remoteWorkspacePath} from git origin ${git.originUrl}.`,
      actions: ["Ensured remote cwd exists", "Prepared git checkout from origin"]
    };
  }
}

export class SshRemoteWorkspaceProvisionRunner implements RemoteWorkspaceProvisionRunner {
  run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn("ssh", [input.sshHost, `sh -lc ${shellQuote(input.remoteScript)}`], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

async function inspectLocalGit(
  workspacePath: string
): Promise<
  | { status: "ready"; originUrl: string; branchName: string | null; commitSha: string }
  | { status: "blocked"; summary: string }
> {
  const topLevel = await runLocalGit(workspacePath, ["rev-parse", "--show-toplevel"]);

  if (topLevel.exitCode !== 0) {
    return {
      status: "blocked",
      summary: `Remote workspace blocked: local workspace ${workspacePath} is not inside a git repository.`
    };
  }

  const origin = await runLocalGit(topLevel.stdout.trim(), ["config", "--get", "remote.origin.url"]);

  if (origin.exitCode !== 0 || origin.stdout.trim() === "") {
    return {
      status: "blocked",
      summary: `Remote workspace blocked: local git repository ${topLevel.stdout.trim()} has no remote origin URL.`
    };
  }

  const branch = await runLocalGit(topLevel.stdout.trim(), ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = await runLocalGit(topLevel.stdout.trim(), ["rev-parse", "HEAD"]);

  if (commit.exitCode !== 0 || commit.stdout.trim() === "") {
    return {
      status: "blocked",
      summary: `Remote workspace blocked: could not resolve local git commit for ${topLevel.stdout.trim()}.`
    };
  }

  return {
    status: "ready",
    originUrl: origin.stdout.trim(),
    branchName: branch.exitCode === 0 && branch.stdout.trim() !== "HEAD" ? branch.stdout.trim() : null,
    commitSha: commit.stdout.trim()
  };
}

function runLocalGit(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function buildGitProvisionScript(input: {
  cwd: string;
  originUrl: string;
  branchName: string | null;
  commitSha: string;
}): string {
  const checkout =
    input.branchName === null
      ? `git checkout ${shellQuote(input.commitSha)}`
      : `git checkout ${shellQuote(input.branchName)} || git checkout -B ${shellQuote(input.branchName)} ${shellQuote(
          `origin/${input.branchName}`
        )}`;

  return [
    "set -eu",
    `mkdir -p ${shellQuote(dirname(input.cwd))}`,
    `if [ -d ${shellQuote(`${input.cwd}/.git`)} ]; then`,
    `  cd ${shellQuote(input.cwd)}`,
    `  git remote set-url origin ${shellQuote(input.originUrl)} || git remote add origin ${shellQuote(input.originUrl)}`,
    "  git fetch --prune origin",
    `elif [ -z "$(ls -A ${shellQuote(input.cwd)} 2>/dev/null)" ]; then`,
    `  git clone ${shellQuote(input.originUrl)} ${shellQuote(input.cwd)}`,
    `  cd ${shellQuote(input.cwd)}`,
    "  git fetch --prune origin",
    "else",
    "  echo 'remote cwd exists but is not an empty git checkout' >&2",
    "  exit 42",
    "fi",
    checkout,
    `git checkout ${shellQuote(input.commitSha)}`
  ].join("\n");
}

function summarizeCommandOutput(result: { stdout: string; stderr: string }): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();

  return output === "" ? "No command output was captured." : output.slice(0, 500);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
