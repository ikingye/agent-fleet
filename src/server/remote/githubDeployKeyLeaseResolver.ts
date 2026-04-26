import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import type { ExecutionNode } from "../../shared/types.js";
import { buildGithubDeployKeyPaths } from "./remoteKeyProvisioner.js";

export interface GithubDeployKeyLeaseConfig {
  repositoryUrl: string;
  repositorySlug: string;
  githubDeployKeyId: string | null;
  publicKeyFingerprint: string;
  localPrivateKeyPath: string;
  remotePrivateKeyPath: string;
}

export interface GithubDeployKeyLeaseResolverInput {
  projectName: string;
  workspacePath: string;
  node: ExecutionNode;
}

export interface GithubDeployKeyLeaseResolver {
  resolve(input: GithubDeployKeyLeaseResolverInput): Promise<GithubDeployKeyLeaseConfig | null>;
}

export class LocalGithubDeployKeyLeaseResolver implements GithubDeployKeyLeaseResolver {
  async resolve(input: GithubDeployKeyLeaseResolverInput): Promise<GithubDeployKeyLeaseConfig | null> {
    const origin = await gitConfigOrigin(input.workspacePath);

    if (origin === null) {
      return null;
    }

    const repository = parseGithubRepository(origin);

    if (repository === null) {
      return null;
    }

    const paths = buildGithubDeployKeyPaths({
      workspacePath: input.workspacePath,
      repositorySlug: repository.slug
    });
    const publicKeyPath = `${paths.localPrivateKeyPath}.pub`;

    try {
      await access(paths.localPrivateKeyPath);
      const publicKey = await readFile(publicKeyPath, "utf8");

      return {
        repositoryUrl: origin,
        repositorySlug: repository.slug,
        githubDeployKeyId: null,
        publicKeyFingerprint: openSshPublicKeyFingerprint(publicKey),
        localPrivateKeyPath: paths.localPrivateKeyPath,
        remotePrivateKeyPath: paths.remotePrivateKeyPath
      };
    } catch {
      return null;
    }
  }
}

async function gitConfigOrigin(workspacePath: string): Promise<string | null> {
  const result = await runGit(workspacePath, ["config", "--get", "remote.origin.url"]);

  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    return null;
  }

  return result.stdout.trim();
}

function runGit(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

function parseGithubRepository(originUrl: string): { owner: string; repo: string; slug: string } | null {
  const scpLike = /^git@github\.com:([^/]+)\/(.+)$/.exec(originUrl);
  const parsed = scpLike ?? parseGithubUrl(originUrl);

  if (parsed === null) {
    return null;
  }

  const owner = parsed[1];
  const repo = parsed[2].replace(/\.git$/i, "");

  if (owner.trim() === "" || repo.trim() === "") {
    return null;
  }

  return {
    owner,
    repo,
    slug: normalizeRepositorySlug(`${owner}-${repo}`)
  };
}

function parseGithubUrl(originUrl: string): RegExpExecArray | null {
  try {
    const url = new URL(originUrl);

    if (url.hostname !== "github.com") {
      return null;
    }

    return /^\/([^/]+)\/(.+)$/.exec(url.pathname);
  } catch {
    return null;
  }
}

export function openSshPublicKeyFingerprint(publicKey: string): string {
  const keyParts = publicKey.trim().split(/\s+/);

  if (keyParts.length < 2 || keyParts[1] === "") {
    throw new Error("OpenSSH public key is invalid");
  }

  const digest = createHash("sha256").update(Buffer.from(keyParts[1], "base64")).digest("base64").replace(/=+$/g, "");

  return `SHA256:${digest}`;
}

function normalizeRepositorySlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug === "" ? "github-repository" : slug;
}
