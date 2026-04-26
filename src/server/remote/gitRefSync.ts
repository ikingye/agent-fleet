import { spawn } from "node:child_process";
import { dirname } from "node:path/posix";

export type GitRefSyncCommand =
  | {
      kind: "git";
      cwd?: string;
      args: string[];
    }
  | {
      kind: "ssh";
      sshHost: string;
      remoteScript: string;
    };

export interface GitRefSyncCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitRefSyncCommandRunner {
  run(command: GitRefSyncCommand): Promise<GitRefSyncCommandResult>;
}

export interface PrepareOutboundGitRefSyncInput {
  workspacePath: string;
  workerName: string;
  allowDirty?: boolean;
}

export interface PrepareRemoteScratchGitRefSyncInput {
  sshHost: string;
  originUrl: string;
  remoteWorkspacePath: string;
  workerBranch: string;
  workerRef: string;
}

export interface FetchInboundGitRefSyncInput {
  workspacePath: string;
  workerName: string;
  expectedSha?: string;
}

export interface GitRefSyncOutboundResult extends GitRefSyncRefs {
  status: "prepared" | "blocked";
  summary: string;
  actions: string[];
  repoRoot: string | null;
  originUrl: string | null;
  baseSha: string | null;
}

export interface GitRefSyncRemoteScratchResult {
  status: "prepared" | "blocked";
  summary: string;
  actions: string[];
}

export interface GitRefSyncInboundResult extends GitRefSyncRefs {
  status: "fetched" | "blocked";
  summary: string;
  actions: string[];
  repoRoot: string | null;
  originUrl: string | null;
  returnedSha: string | null;
}

interface GitRefSyncRefs {
  workerBranch: string;
  workerRef: string;
  returnedBranch: string;
  returnedRef: string;
}

export class GitRefSync {
  constructor(private readonly runner: GitRefSyncCommandRunner = new SpawnGitRefSyncCommandRunner()) {}

  async prepareOutbound(input: PrepareOutboundGitRefSyncInput): Promise<GitRefSyncOutboundResult> {
    const refs = buildGitRefSyncRefs(input.workerName);
    const repoRoot = await this.git(input.workspacePath, ["rev-parse", "--show-toplevel"]);

    if (repoRoot.exitCode !== 0 || repoRoot.stdout.trim() === "") {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: local workspace ${input.workspacePath} is not inside a git repository.`,
        actions: [summarizeCommandOutput(repoRoot)],
        repoRoot: null,
        originUrl: null,
        baseSha: null,
        ...refs
      };
    }

    const root = repoRoot.stdout.trim();
    const origin = await this.git(root, ["config", "--get", "remote.origin.url"]);

    if (origin.exitCode !== 0 || origin.stdout.trim() === "") {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: local git repository ${root} has no remote origin URL.`,
        actions: [summarizeCommandOutput(origin)],
        repoRoot: root,
        originUrl: null,
        baseSha: null,
        ...refs
      };
    }

    const status = await this.git(root, ["status", "--porcelain=v1", "-z"]);

    if (status.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: failed to inspect porcelain status for ${root}.`,
        actions: [summarizeCommandOutput(status)],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        baseSha: null,
        ...refs
      };
    }

    if (input.allowDirty !== true && status.stdout !== "") {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: local repository ${root} has a dirty worktree.`,
        actions: ["Commit, stash, or explicitly allow dirty sync before remote git-ref sync."],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        baseSha: null,
        ...refs
      };
    }

    const head = await this.git(root, ["rev-parse", "HEAD"]);

    if (head.exitCode !== 0 || head.stdout.trim() === "") {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: could not resolve HEAD for ${root}.`,
        actions: [summarizeCommandOutput(head)],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        baseSha: null,
        ...refs
      };
    }

    const baseSha = head.stdout.trim();
    const push = await this.git(root, ["push", "origin", `${baseSha}:${refs.workerRef}`]);

    if (push.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: failed to push Worker ref ${refs.workerRef}.`,
        actions: [summarizeCommandOutput(push)],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        baseSha,
        ...refs
      };
    }

    return {
      status: "prepared",
      summary: `Remote git-ref sync prepared ${refs.workerRef} at ${baseSha}.`,
      actions: [`Pushed ${baseSha} to origin ${refs.workerRef}`],
      repoRoot: root,
      originUrl: origin.stdout.trim(),
      baseSha,
      ...refs
    };
  }

  async prepareRemoteScratch(input: PrepareRemoteScratchGitRefSyncInput): Promise<GitRefSyncRemoteScratchResult> {
    const result = await this.runner.run({
      kind: "ssh",
      sshHost: input.sshHost,
      remoteScript: buildRemoteScratchScript(input)
    });

    if (result.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Remote git-ref sync blocked: failed to prepare remote scratch checkout ${input.remoteWorkspacePath}.`,
        actions: [summarizeCommandOutput(result)]
      };
    }

    return {
      status: "prepared",
      summary: `Remote git-ref sync prepared remote scratch checkout ${input.remoteWorkspacePath} from ${input.workerRef}.`,
      actions: [`Checked out ${input.workerRef} on remote scratch workspace`]
    };
  }

  async fetchInbound(input: FetchInboundGitRefSyncInput): Promise<GitRefSyncInboundResult> {
    const refs = buildGitRefSyncRefs(input.workerName);
    const repoRoot = await this.git(input.workspacePath, ["rev-parse", "--show-toplevel"]);

    if (repoRoot.exitCode !== 0 || repoRoot.stdout.trim() === "") {
      return {
        status: "blocked",
        summary: `Returned git-ref sync blocked: local workspace ${input.workspacePath} is not inside a git repository.`,
        actions: [summarizeCommandOutput(repoRoot)],
        repoRoot: null,
        originUrl: null,
        returnedSha: null,
        ...refs
      };
    }

    const root = repoRoot.stdout.trim();
    const origin = await this.git(root, ["config", "--get", "remote.origin.url"]);

    if (origin.exitCode !== 0 || origin.stdout.trim() === "") {
      return {
        status: "blocked",
        summary: `Returned git-ref sync blocked: local git repository ${root} has no remote origin URL.`,
        actions: [summarizeCommandOutput(origin)],
        repoRoot: root,
        originUrl: null,
        returnedSha: null,
        ...refs
      };
    }

    const fetch = await this.git(root, ["fetch", "origin", refs.returnedRef]);

    if (fetch.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Returned git-ref sync blocked: failed to fetch returned ref ${refs.returnedRef}.`,
        actions: [summarizeCommandOutput(fetch)],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        returnedSha: null,
        ...refs
      };
    }

    const returnedHead = await this.git(root, ["rev-parse", "FETCH_HEAD"]);

    if (returnedHead.exitCode !== 0 || returnedHead.stdout.trim() === "") {
      return {
        status: "blocked",
        summary: `Returned git-ref sync blocked: could not resolve FETCH_HEAD for ${refs.returnedRef}.`,
        actions: [summarizeCommandOutput(returnedHead)],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        returnedSha: null,
        ...refs
      };
    }

    const returnedSha = returnedHead.stdout.trim();

    if (input.expectedSha !== undefined && input.expectedSha !== returnedSha) {
      return {
        status: "blocked",
        summary: `Returned git-ref sync blocked: returned SHA ${returnedSha} did not match expected SHA ${input.expectedSha}.`,
        actions: ["Fetched returned ref but did not check it out because the expected SHA did not match."],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        returnedSha,
        ...refs
      };
    }

    const checkout = await this.git(root, ["checkout", "-B", refs.returnedBranch, "FETCH_HEAD"]);

    if (checkout.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Returned git-ref sync blocked: failed to check out returned branch ${refs.returnedBranch}.`,
        actions: [summarizeCommandOutput(checkout)],
        repoRoot: root,
        originUrl: origin.stdout.trim(),
        returnedSha,
        ...refs
      };
    }

    return {
      status: "fetched",
      summary: `Returned git-ref sync fetched ${refs.returnedRef} at ${returnedSha}.`,
      actions: [`Fetched ${refs.returnedRef}`, `Checked out ${refs.returnedBranch}`],
      repoRoot: root,
      originUrl: origin.stdout.trim(),
      returnedSha,
      ...refs
    };
  }

  private git(cwd: string, args: string[]): Promise<GitRefSyncCommandResult> {
    return this.runner.run({ kind: "git", cwd, args });
  }
}

export class SpawnGitRefSyncCommandRunner implements GitRefSyncCommandRunner {
  run(command: GitRefSyncCommand): Promise<GitRefSyncCommandResult> {
    if (command.kind === "git") {
      return spawnCommand("git", command.args, command.cwd);
    }

    return spawnCommand("ssh", [command.sshHost, `sh -lc ${shellQuote(command.remoteScript)}`]);
  }
}

export function buildGitRefSyncRefs(workerName: string): GitRefSyncRefs {
  const workerSlug = slugRefSegment(workerName);
  const workerBranch = `agent-fleet/workers/${workerSlug}`;
  const returnedBranch = `agent-fleet/results/${workerSlug}`;

  return {
    workerBranch,
    workerRef: `refs/heads/${workerBranch}`,
    returnedBranch,
    returnedRef: `refs/heads/${returnedBranch}`
  };
}

function buildRemoteScratchScript(input: PrepareRemoteScratchGitRefSyncInput): string {
  const remoteTrackingRef = `refs/remotes/origin/${input.workerBranch}`;
  const refspec = `+${input.workerRef}:${remoteTrackingRef}`;

  return [
    "set -eu",
    `mkdir -p ${shellQuote(dirname(input.remoteWorkspacePath))}`,
    `if [ -d ${shellQuote(`${input.remoteWorkspacePath}/.git`)} ]; then`,
    `  cd ${shellQuote(input.remoteWorkspacePath)}`,
    `  git remote set-url origin ${shellQuote(input.originUrl)} || git remote add origin ${shellQuote(input.originUrl)}`,
    `elif [ -z "$(ls -A ${shellQuote(input.remoteWorkspacePath)} 2>/dev/null)" ]; then`,
    `  git clone --no-checkout ${shellQuote(input.originUrl)} ${shellQuote(input.remoteWorkspacePath)}`,
    `  cd ${shellQuote(input.remoteWorkspacePath)}`,
    "else",
    "  echo 'remote cwd exists but is not an empty git checkout' >&2",
    "  exit 42",
    "fi",
    `git fetch origin ${shellQuote(refspec)}`,
    `git checkout -B ${shellQuote(input.workerBranch)} FETCH_HEAD`
  ].join("\n");
}

function spawnCommand(command: string, args: string[], cwd?: string): Promise<GitRefSyncCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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

function summarizeCommandOutput(result: GitRefSyncCommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();

  return output === "" ? "No command output was captured." : output.slice(0, 500);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function slugRefSegment(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w./-]/g, "-")
    .replace(/^[./-]+|[./-]+$/g, "")
    .replace(/\.lock$/i, "")
    .replaceAll("..", ".")
    .replaceAll("//", "/");

  return slug === "" ? "worker" : slug;
}
