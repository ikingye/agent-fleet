import { posix } from "node:path";

export const REMOTE_AGENT_FLEET_ROOT = "/tmp/agent-fleet";
export const DEFAULT_REMOTE_WORK_ROOT = posix.join(REMOTE_AGENT_FLEET_ROOT, "work");

export function normalizeRemoteWorkRoot(workRoot: string | null): string {
  const trimmed = workRoot?.trim();

  if (trimmed === undefined || trimmed === "") {
    return DEFAULT_REMOTE_WORK_ROOT;
  }

  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "");
}
