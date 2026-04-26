import type { ExecutionNode } from "../../shared/types.js";
import { evaluateRemoteNodeReadiness } from "./remoteNodeReadiness.js";
import { normalizeRemoteWorkRoot } from "./remotePaths.js";
import { SshRemoteCommandRunner, type RemoteCommandRunner } from "./remoteWorkerProbe.js";

export type { RemoteCommandRunner } from "./remoteWorkerProbe.js";

export type RemoteOnboardingCheckStatus = "pass" | "fail";

export interface RemoteOnboardingCheck {
  id: "configuration" | "ssh" | "workRoot" | "codex" | "git" | "githubSsh" | "proxy";
  label: string;
  status: RemoteOnboardingCheckStatus;
  summary: string;
}

export interface RemoteNodeOnboardingResult {
  nodeId: string;
  ready: boolean;
  normalizedWorkRoot: string;
  checks: RemoteOnboardingCheck[];
}

export interface RunRemoteNodeOnboardingInput {
  node: ExecutionNode;
  codexCommand: string;
  runner?: RemoteCommandRunner;
}

const CHECK_LABELS: Record<RemoteOnboardingCheck["id"], string> = {
  configuration: "Remote node configuration",
  ssh: "SSH reachability",
  workRoot: "Remote work root",
  codex: "Codex command and login",
  git: "Git command",
  githubSsh: "GitHub SSH auth",
  proxy: "Proxy availability"
};

export async function runRemoteNodeOnboarding(
  input: RunRemoteNodeOnboardingInput
): Promise<RemoteNodeOnboardingResult> {
  const codexCommand = normalizeCommand(input.codexCommand);
  const normalizedWorkRoot = normalizeRemoteWorkRoot(input.node.workRoot);

  if (input.node.kind !== "remote") {
    return onboardingResult(input.node.id, normalizedWorkRoot, [
      check("configuration", "fail", "node is not remote")
    ]);
  }

  const staticReadiness = evaluateRemoteNodeReadiness({
    status: input.node.status,
    sshHost: input.node.sshHost,
    workRoot: normalizedWorkRoot,
    proxyUrl: input.node.proxyUrl,
    proxyRequired: false
  });

  if (!staticReadiness.ready) {
    return onboardingResult(input.node.id, normalizedWorkRoot, [
      check("configuration", "fail", staticReadiness.reasons.join("; "))
    ]);
  }

  const sshHost = input.node.sshHost?.trim() ?? "";
  const runner = input.runner ?? new SshRemoteCommandRunner();
  const result = await runner.run({
    sshHost,
    remoteScript: buildRemoteOnboardingScript({
      normalizedWorkRoot,
      codexCommand,
      proxyConfigured: input.node.proxyUrl !== null && input.node.proxyUrl.trim() !== ""
    })
  });
  const checks = parseRemoteChecks(result.stdout);

  if (!checks.some((item) => item.id === "ssh")) {
    checks.unshift(check("ssh", "fail", "SSH command could not complete on the remote node."));
  }

  if (result.exitCode !== 0 && checks.every((item) => item.status === "pass")) {
    checks.push(check("configuration", "fail", "Remote onboarding script exited before all checks completed."));
  }

  return onboardingResult(input.node.id, normalizedWorkRoot, checks);
}

function onboardingResult(
  nodeId: string,
  normalizedWorkRoot: string,
  checks: RemoteOnboardingCheck[]
): RemoteNodeOnboardingResult {
  return {
    nodeId,
    ready: checks.length > 0 && checks.every((item) => item.status === "pass"),
    normalizedWorkRoot,
    checks
  };
}

function buildRemoteOnboardingScript(input: {
  normalizedWorkRoot: string;
  codexCommand: string;
  proxyConfigured: boolean;
}): string {
  return [
    "set -u",
    "emit() { printf 'AF_CHECK\\t%s\\t%s\\t%s\\n' \"$1\" \"$2\" \"$3\"; }",
    `WORK_ROOT=${shellQuote(input.normalizedWorkRoot)}`,
    `CODEX_CMD=${shellQuote(input.codexCommand)}`,
    `PROXY_REQUIRED=${shellQuote(input.proxyConfigured ? "1" : "0")}`,
    "emit ssh pass 'SSH command execution succeeded.'",
    "if mkdir -p \"$WORK_ROOT\" \"$WORK_ROOT/repos\" \"$WORK_ROOT/worktrees\" \"$WORK_ROOT/logs\" && test -w \"$WORK_ROOT\" && test -w \"$WORK_ROOT/repos\" && test -w \"$WORK_ROOT/worktrees\" && test -w \"$WORK_ROOT/logs\"; then",
    "  emit workRoot pass 'Remote work directory structure is writable.'",
    "else",
    "  emit workRoot fail 'Remote work directory structure is not writable.'",
    "fi",
    "if command -v \"$CODEX_CMD\" >/dev/null 2>&1; then",
    "  if \"$CODEX_CMD\" login status >/dev/null 2>&1; then",
    "    emit codex pass 'Codex command is installed and logged in.'",
    "  else",
    "    emit codex fail 'Codex command is installed but login status failed.'",
    "  fi",
    "else",
    "  emit codex fail 'Codex command is not available on PATH.'",
    "fi",
    "if command -v git >/dev/null 2>&1; then",
    "  emit git pass 'Git command is available.'",
    "else",
    "  emit git fail 'Git command is not available on PATH.'",
    "fi",
    "github_output=$(ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 git@github.com 2>&1 </dev/null)",
    "case \"$github_output\" in",
    "  *'successfully authenticated'*|*\"You've successfully authenticated\"*)",
    "    emit githubSsh pass 'GitHub SSH auth smoke succeeded.'",
    "    ;;",
    "  *'REMOTE HOST IDENTIFICATION HAS CHANGED'*|*'Host key verification failed'*|*'Connection timed out'*|*'Operation timed out'*|*'Connection refused'*|*'Could not resolve hostname'*|*'kex_exchange_identification'*)",
    "    emit githubSsh fail 'GitHub SSH on github.com looks blocked or host-key suspicious. Try ssh -T -p 443 git@ssh.github.com.'",
    "    ;;",
    "  *)",
    "    emit githubSsh fail 'GitHub SSH auth smoke failed; verify deploy-key access before remote dispatch.'",
    "    ;;",
    "esac",
    "if [ \"$PROXY_REQUIRED\" = '1' ]; then",
    "  if command -v nc >/dev/null 2>&1 && nc -z -w 2 127.0.0.1 1080 >/dev/null 2>&1; then",
    "    emit proxy pass 'Configured proxy is reachable at 127.0.0.1:1080.'",
    "  elif command -v bash >/dev/null 2>&1 && bash -lc '</dev/tcp/127.0.0.1/1080' >/dev/null 2>&1; then",
    "    emit proxy pass 'Configured proxy is reachable at 127.0.0.1:1080.'",
    "  else",
    "    emit proxy fail 'Configured proxy is not reachable at 127.0.0.1:1080.'",
    "  fi",
    "else",
    "  emit proxy pass 'No proxy configured.'",
    "fi"
  ].join("\n");
}

function parseRemoteChecks(stdout: string): RemoteOnboardingCheck[] {
  const checks: RemoteOnboardingCheck[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("AF_CHECK\t")) {
      continue;
    }

    const [, id, status, summary] = line.split("\t");

    if (!isCheckId(id) || !isCheckStatus(status) || summary === undefined) {
      continue;
    }

    checks.push(check(id, status, summary));
  }

  return checks;
}

function check(
  id: RemoteOnboardingCheck["id"],
  status: RemoteOnboardingCheckStatus,
  summary: string
): RemoteOnboardingCheck {
  return {
    id,
    label: CHECK_LABELS[id],
    status,
    summary
  };
}

function isCheckId(value: string | undefined): value is RemoteOnboardingCheck["id"] {
  return (
    value === "configuration" ||
    value === "ssh" ||
    value === "workRoot" ||
    value === "codex" ||
    value === "git" ||
    value === "githubSsh" ||
    value === "proxy"
  );
}

function isCheckStatus(value: string | undefined): value is RemoteOnboardingCheckStatus {
  return value === "pass" || value === "fail";
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
