import { posix } from "node:path";

export interface EvaluateRemoteNodeReadinessInput {
  status: "ready" | "offline" | "unknown";
  sshHost: string | null;
  workRoot: string;
  proxyUrl: string | null;
  proxyRequired: boolean;
}

export interface RemoteNodeReadiness {
  ready: boolean;
  reasons: string[];
}

export function evaluateRemoteNodeReadiness(input: EvaluateRemoteNodeReadinessInput): RemoteNodeReadiness {
  const reasons: string[] = [];

  if (input.status !== "ready") {
    reasons.push(`node status is ${input.status}`);
  }

  if (input.sshHost === null || input.sshHost.trim() === "") {
    reasons.push("ssh host is required");
  }

  if (!posix.isAbsolute(input.workRoot)) {
    reasons.push("work root must be an absolute path");
  }

  if (input.proxyRequired && (input.proxyUrl === null || input.proxyUrl.trim() === "")) {
    reasons.push("proxy url is required");
  }

  return {
    ready: reasons.length === 0,
    reasons
  };
}
