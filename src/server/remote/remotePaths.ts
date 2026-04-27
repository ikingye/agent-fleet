import { posix } from "node:path";

export const REMOTE_AGENT_FLEET_ROOT = "/tmp/agent-fleet";
export const DEFAULT_REMOTE_WORK_ROOT = posix.join(REMOTE_AGENT_FLEET_ROOT, "work");

export function normalizeRemoteWorkRoot(workRoot: string | null): string {
  const trimmed = workRoot?.trim() ?? "";

  if (trimmed === "") {
    return DEFAULT_REMOTE_WORK_ROOT;
  }

  const normalized = posix.normalize(trimmed);
  const canonical = normalized === "/" ? normalized : normalized.replace(/\/+$/, "");

  if (canonical === REMOTE_AGENT_FLEET_ROOT) {
    return DEFAULT_REMOTE_WORK_ROOT;
  }

  return canonical;
}
