import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dirname } from "node:path/posix";
import type { GithubDeployKeyCleanupStatus, GithubDeployKeyLease } from "../../shared/types.js";

export interface GithubDeployKeyPathInput {
  workspacePath: string;
  repositorySlug: string;
}

export interface GithubDeployKeyPaths {
  localPrivateKeyPath: string;
  remotePrivateKeyPath: string;
}

export interface GithubDeployKeyGitSshCommandInput {
  privateKeyPath: string;
  githubSshHostAlias?: boolean;
  strictHostKeyChecking?: "accept-new" | "yes" | "no";
}

export interface RemoteKeyProvisionCommand {
  kind: "ssh";
  sshHost: string;
  remoteScript: string;
  stdin: string | Buffer;
}

export interface RemoteKeyProvisionCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RemoteKeyProvisionCommandRunner {
  run(command: RemoteKeyProvisionCommand): Promise<RemoteKeyProvisionCommandResult>;
}

export interface RemoteKeyProvisionLocalReader {
  readFile(path: string): Promise<string | Buffer>;
}

export interface RemoteGithubDeployKeyProvisionerOptions {
  runner?: RemoteKeyProvisionCommandRunner;
  localReader?: RemoteKeyProvisionLocalReader;
}

export interface RemoteKeyInstallInput {
  lease: GithubDeployKeyLease;
  sshHost: string;
}

export interface RemoteKeyInstallResult {
  status: "installed" | "blocked";
  summary: string;
  actions: string[];
  gitSshCommand: string | null;
}

export interface RemoteKeyCleanupInput {
  lease: GithubDeployKeyLease;
  sshHost: string;
}

export interface RemoteKeyCleanupResult {
  status: "completed" | "failed" | "skipped";
  summary: string;
  actions: string[];
  cleanupStatus: GithubDeployKeyCleanupStatus;
}

class NodeLocalKeyReader implements RemoteKeyProvisionLocalReader {
  readFile(path: string): Promise<Buffer> {
    return readFile(path);
  }
}

export class RemoteGithubDeployKeyProvisioner {
  private readonly runner: RemoteKeyProvisionCommandRunner;
  private readonly localReader: RemoteKeyProvisionLocalReader;

  constructor(options: RemoteGithubDeployKeyProvisionerOptions = {}) {
    this.runner = options.runner ?? new SshRemoteKeyProvisionRunner();
    this.localReader = options.localReader ?? new NodeLocalKeyReader();
  }

  async installRemoteKey(input: RemoteKeyInstallInput): Promise<RemoteKeyInstallResult> {
    const sshHost = normalizeRequired("sshHost", input.sshHost);
    const keyMaterial = await this.readLocalKey(input.lease.localPrivateKeyPath);

    if (keyMaterial.status === "blocked") {
      return {
        status: "blocked",
        summary: `Remote deploy key blocked: local deploy key source is unavailable for ${input.lease.repositorySlug}.`,
        actions: [keyMaterial.reason],
        gitSshCommand: null
      };
    }

    const result = await this.runner.run({
      kind: "ssh",
      sshHost,
      remoteScript: buildInstallRemoteKeyScript(input.lease.remotePrivateKeyPath),
      stdin: keyMaterial.content
    });

    if (result.exitCode !== 0) {
      return {
        status: "blocked",
        summary: `Remote deploy key blocked: failed to install key copy for ${input.lease.repositorySlug}.`,
        actions: [summarizeCommandOutput(result)],
        gitSshCommand: null
      };
    }

    return {
      status: "installed",
      summary: `Remote deploy key installed for ${input.lease.repositorySlug}.`,
      actions: [`Installed ephemeral deploy key at ${input.lease.remotePrivateKeyPath}`],
      gitSshCommand: buildGithubDeployKeyGitSshCommand({
        privateKeyPath: input.lease.remotePrivateKeyPath,
        githubSshHostAlias: true
      })
    };
  }

  async cleanupRemoteKey(input: RemoteKeyCleanupInput): Promise<RemoteKeyCleanupResult> {
    const sshHost = normalizeRequired("sshHost", input.sshHost);

    if (!shouldCleanupLease(input.lease)) {
      return {
        status: "skipped",
        summary: `Remote deploy key cleanup skipped for ${input.lease.repositorySlug}.`,
        actions: ["Lease is not pending zero-ref cleanup."],
        cleanupStatus: input.lease.cleanupStatus
      };
    }

    const result = await this.runner.run({
      kind: "ssh",
      sshHost,
      remoteScript: buildCleanupRemoteKeyScript(input.lease.remotePrivateKeyPath),
      stdin: ""
    });

    if (result.exitCode !== 0) {
      return {
        status: "failed",
        summary: `Remote deploy key cleanup failed for ${input.lease.repositorySlug}.`,
        actions: [summarizeCommandOutput(result)],
        cleanupStatus: "failed"
      };
    }

    return {
      status: "completed",
      summary: `Remote deploy key cleanup completed for ${input.lease.repositorySlug}.`,
      actions: [`Removed ephemeral deploy key at ${input.lease.remotePrivateKeyPath}`],
      cleanupStatus: "completed"
    };
  }

  private async readLocalKey(path: string): Promise<{ status: "read"; content: string | Buffer } | { status: "blocked"; reason: string }> {
    try {
      return { status: "read", content: await this.localReader.readFile(path) };
    } catch (error) {
      return { status: "blocked", reason: `Failed to read local deploy key at ${path}: ${errorMessage(error)}` };
    }
  }
}

export class SshRemoteKeyProvisionRunner implements RemoteKeyProvisionCommandRunner {
  run(command: RemoteKeyProvisionCommand): Promise<RemoteKeyProvisionCommandResult> {
    return new Promise((resolve) => {
      const child = spawn("ssh", [command.sshHost, `sh -lc ${shellQuote(command.remoteScript)}`], {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
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
      child.stdin.end(command.stdin);
    });
  }
}

export function buildGithubDeployKeyPaths(input: GithubDeployKeyPathInput): GithubDeployKeyPaths {
  const workspacePath = normalizeRequired("workspacePath", input.workspacePath);
  const repositorySlug = normalizeRepositorySlug(input.repositorySlug);

  return {
    localPrivateKeyPath: join(workspacePath, ".agent-fleet", "secrets", repositorySlug, "github-deploy-key"),
    remotePrivateKeyPath: `/tmp/agent-fleet/keys/${repositorySlug}/github-deploy-key`
  };
}

export function buildGithubDeployKeyGitSshCommand(input: GithubDeployKeyGitSshCommandInput): string {
  const privateKeyPath = normalizeAbsoluteRemotePath("privateKeyPath", input.privateKeyPath);
  const strictHostKeyChecking = input.strictHostKeyChecking ?? "accept-new";
  const args = [
    "ssh",
    "-i",
    privateKeyPath,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `StrictHostKeyChecking=${strictHostKeyChecking}`
  ];

  if (input.githubSshHostAlias === true) {
    args.push("-o", "HostName=ssh.github.com", "-o", "Port=443");
  }

  return args.map(shellQuoteGitSshArg).join(" ");
}

function buildInstallRemoteKeyScript(remotePrivateKeyPath: string): string {
  const keyPath = normalizeAbsoluteRemotePath("remotePrivateKeyPath", remotePrivateKeyPath);
  const keyDir = dirname(keyPath);
  const secureDirs = secureRemoteDirectories(keyPath);

  return [
    "set -eu",
    "umask 077",
    `mkdir -p ${shellQuote(keyDir)}`,
    `chmod 700 ${secureDirs.map(shellQuote).join(" ")}`,
    `agent_fleet_key_tmp=$(mktemp ${shellQuote(`${keyDir}/.github-deploy-key.XXXXXX`)})`,
    'trap \'rm -f "$agent_fleet_key_tmp"\' EXIT HUP INT TERM',
    'cat > "$agent_fleet_key_tmp"',
    'chmod 600 "$agent_fleet_key_tmp"',
    `mv "$agent_fleet_key_tmp" ${shellQuote(keyPath)}`,
    `chmod 600 ${shellQuote(keyPath)}`,
    "trap - EXIT HUP INT TERM"
  ].join("\n");
}

function buildCleanupRemoteKeyScript(remotePrivateKeyPath: string): string {
  const keyPath = normalizeAbsoluteRemotePath("remotePrivateKeyPath", remotePrivateKeyPath);
  const keyDir = dirname(keyPath);

  return [
    "set -eu",
    `rm -f ${shellQuote(keyPath)}`,
    `rmdir ${shellQuote(keyDir)} 2>/dev/null || true`
  ].join("\n");
}

function shouldCleanupLease(lease: GithubDeployKeyLease): boolean {
  return lease.cleanupStatus === "pending" && lease.refcount === 0 && lease.status !== "active";
}

function secureRemoteDirectories(remotePrivateKeyPath: string): string[] {
  const keyDir = dirname(remotePrivateKeyPath);
  const dirs =
    remotePrivateKeyPath.startsWith("/tmp/agent-fleet/keys/") === true
      ? ["/tmp/agent-fleet", "/tmp/agent-fleet/keys", keyDir]
      : [keyDir];

  return [...new Set(dirs)];
}

function normalizeRepositorySlug(repositorySlug: string): string {
  const normalized = normalizeRequired("repositorySlug", repositorySlug);

  if (normalized === "." || normalized === ".." || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error("repositorySlug must be a single path segment");
  }

  return normalized;
}

function normalizeAbsoluteRemotePath(name: string, value: string): string {
  const normalized = normalizeRequired(name, value);

  if (!normalized.startsWith("/")) {
    throw new Error(`${name} must be an absolute path`);
  }

  if (normalized.includes("\0")) {
    throw new Error(`${name} must not contain NUL bytes`);
  }

  return normalized;
}

function normalizeRequired(name: string, value: string): string {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function summarizeCommandOutput(result: RemoteKeyProvisionCommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();

  return output === "" ? "No command output was captured." : output.slice(0, 500);
}

function shellQuoteGitSshArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return shellQuote(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
