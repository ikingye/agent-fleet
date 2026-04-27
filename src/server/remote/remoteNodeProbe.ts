import type { ExecutionNode } from "../../shared/types.js";
import { evaluateRemoteNodeReadiness } from "./remoteNodeReadiness.js";
import { normalizeRemoteWorkRoot } from "./remotePaths.js";
import { SshRemoteCommandRunner, type RemoteCommandRunner } from "./remoteWorkerProbe.js";

export type { RemoteCommandRunner } from "./remoteWorkerProbe.js";

export interface RemoteExecutionNodeProbeResult {
  ready: boolean;
  reasons: string[];
  checks: {
    sshHost: string | null;
    workRoot: string;
    codexCommand: string;
  };
}

export interface ProbeRemoteExecutionNodeInput {
  node: ExecutionNode;
  codexCommand: string;
  runner?: RemoteCommandRunner;
}

export async function probeRemoteExecutionNode(
  input: ProbeRemoteExecutionNodeInput
): Promise<RemoteExecutionNodeProbeResult> {
  const codexCommand = normalizeCommand(input.codexCommand);
  const workRoot = normalizeRemoteWorkRoot(input.node.workRoot);
  const checks = {
    sshHost: input.node.sshHost,
    workRoot,
    codexCommand
  };

  if (input.node.kind !== "remote") {
    return {
      ready: false,
      reasons: ["node is not remote"],
      checks
    };
  }

  const staticReadiness = evaluateRemoteNodeReadiness({
    status: input.node.status,
    sshHost: input.node.sshHost,
    workRoot,
    proxyUrl: input.node.proxyUrl,
    proxyRequired: false
  });

  if (!staticReadiness.ready) {
    return {
      ready: false,
      reasons: staticReadiness.reasons,
      checks
    };
  }

  const sshHost = input.node.sshHost?.trim() ?? "";
  const runner = input.runner ?? new SshRemoteCommandRunner();
  const result = await runner.run({
    sshHost,
    remoteScript: `test -d ${shellQuote(workRoot)} && command -v ${shellQuote(codexCommand)} >/dev/null 2>&1`
  });

  if (result.exitCode === 0) {
    return {
      ready: true,
      reasons: [],
      checks
    };
  }

  return {
    ready: false,
    reasons: ["remote workRoot or codex command check failed"],
    checks
  };
}

function normalizeCommand(command: string): string {
  const normalized = command.trim();

  if (normalized === "") {
    throw new Error("codexCommand is required");
  }

  if (normalized.startsWith("-")) {
    throw new Error("codexCommand must not start with '-'");
  }

  return normalized;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
