import { describe, expect, it } from "vitest";
import type { Goal, MemoryEntry } from "../../shared/types.js";
import { buildMemoryContext, correctionMemoryKeys } from "./memoryContext.js";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    projectName: "agent-fleet",
    workspacePath: "/projects/agent-fleet",
    title: "Improve Steward memory",
    body: "Make durable memory affect Worker prompts.",
    status: "queued",
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides
  };
}

function memory(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: overrides.id ?? "memory-1",
    scope: overrides.scope ?? "user",
    projectName: overrides.projectName ?? null,
    key: overrides.key ?? "preference:terminology:steward-worker",
    value: overrides.value ?? "Use Steward Agent and Worker Agent terminology.",
    sourceCorrectionId: overrides.sourceCorrectionId ?? null,
    createdAt: overrides.createdAt ?? "2026-04-26T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-26T00:00:00.000Z"
  };
}

describe("buildMemoryContext", () => {
  it("returns user-wide memories and project memories matching the goal in deterministic order", () => {
    const context = buildMemoryContext({
      goal: goal(),
      memories: [
        memory({
          id: "other-project",
          scope: "project",
          projectName: "mahjong",
          key: "preference:workspace",
          value: "Keep mahjong implementation in /projects/mahjong."
        }),
        memory({
          id: "project-worker-naming",
          scope: "project",
          projectName: "agent-fleet",
          key: "preference:worker-naming",
          value: "Worker names must follow <project-name>-<purpose>-YYYYMMDDHHmm."
        }),
        memory({
          id: "user-terminology",
          scope: "user",
          projectName: null,
          key: "preference:terminology:steward-worker",
          value: "Use Steward Agent and Worker Agent terminology."
        })
      ]
    });

    expect(context.entries.map((entry) => entry.id)).toEqual(["user-terminology", "project-worker-naming"]);
    expect(context.promptLines).toEqual([
      "Relevant owner memory:",
      "- Use Steward Agent and Worker Agent terminology.",
      "- Worker names must follow <project-name>-<purpose>-YYYYMMDDHHmm."
    ]);
    expect(context.summary).toBe("Applied 2 relevant owner memories.");
  });

  it("returns an empty context when no memory matches the goal scope", () => {
    const context = buildMemoryContext({
      goal: goal({ projectName: "external-app", workspacePath: "/projects/external-app" }),
      memories: [
        memory({
          id: "agent-fleet-only",
          scope: "project",
          projectName: "agent-fleet",
          key: "preference:ui",
          value: "Keep dashboard status compact."
        })
      ]
    });

    expect(context.entries).toEqual([]);
    expect(context.promptLines).toEqual([]);
    expect(context.summary).toBe(null);
  });
});

describe("correctionMemoryKeys", () => {
  it("recognizes generic home-path privacy corrections", () => {
    const macWorkspace = ["", "Users", "example-owner", "code", "project", "mahjong"].join("/");
    const linuxWorkspace = ["", "home", "builder", "work", "mahjong"].join("/");

    expect(correctionMemoryKeys(`Redact ${macWorkspace} from display.`)).toContain(
      "preference:ui:owner-facing-privacy"
    );
    expect(correctionMemoryKeys(`Redact ${linuxWorkspace} from display.`)).toContain(
      "preference:ui:owner-facing-privacy"
    );
  });
});
