import type { Goal, MemoryEntry } from "../../shared/types.js";

export interface MemoryContext {
  entries: MemoryEntry[];
  promptLines: string[];
  summary: string | null;
}

export function buildMemoryContext(input: { goal: Goal; memories: MemoryEntry[] }): MemoryContext {
  const entries = input.memories
    .filter((memory) => memoryAppliesToGoal(memory, input.goal))
    .sort(compareMemoryEntries);

  if (entries.length === 0) {
    return {
      entries: [],
      promptLines: [],
      summary: null
    };
  }

  return {
    entries,
    promptLines: ["Relevant owner memory:", ...entries.map((entry) => `- ${entry.value}`)],
    summary: `Applied ${entries.length} relevant owner ${entries.length === 1 ? "memory" : "memories"}.`
  };
}

export function correctionMemoryKeys(body: string): string[] {
  const normalized = body.toLowerCase();
  const keys = new Set<string>();

  if (/(butler|task agent|terminology|steward agent.*worker agent|worker agent.*steward agent)/.test(normalized)) {
    keys.add("preference:terminology:steward-worker");
  }

  if (/(long|high-load|high load|cpu|gpu|heavy|remote)/.test(normalized) && /remote|server|node|offload/.test(normalized)) {
    keys.add("preference:execution:remote-high-load");
  }

  if (/worker names?|worker name|worker-name|-remote-|yyyyMMddhhmm/i.test(body)) {
    keys.add("preference:worker-naming:remote-marker");
  }

  if (/workspace path|workspace paths|own workspace|target workspace|external projects?/.test(normalized)) {
    keys.add("preference:workspace:target-workspace-paths");
  }

  if (/\/(?:users|home)\/[^/\s]+|avoid.*ui|dashboard|owner-facing ui|owner facing ui/.test(normalized)) {
    keys.add("preference:ui:owner-facing-privacy");
  }

  if (/(escalate|review|ask me|human review|double-check|double check)/.test(normalized) && /(irreversible|merge|high-impact|important decision)/.test(normalized)) {
    keys.add("preference:decision-review:high-impact");
  }

  return keys.size === 0 ? ["correction:general"] : [...keys].sort();
}

function memoryAppliesToGoal(memory: MemoryEntry, goal: Goal): boolean {
  if (memory.scope === "user") {
    return memory.projectName === null;
  }

  if (memory.projectName !== goal.projectName) {
    return false;
  }

  return memoryMatchesWorkspace(memory, goal.workspacePath);
}

function memoryMatchesWorkspace(memory: MemoryEntry, workspacePath: string | undefined): boolean {
  if (!memory.key.startsWith("workspace:")) {
    return true;
  }

  if (workspacePath === undefined || workspacePath.trim() === "") {
    return false;
  }

  return memory.key.startsWith(`workspace:${workspacePath}:`);
}

function compareMemoryEntries(left: MemoryEntry, right: MemoryEntry): number {
  const scopeRank = memoryScopeRank(left) - memoryScopeRank(right);

  if (scopeRank !== 0) {
    return scopeRank;
  }

  return (
    left.key.localeCompare(right.key) ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function memoryScopeRank(memory: MemoryEntry): number {
  return memory.scope === "user" ? 0 : 1;
}
