import { describe, expect, it } from "vitest";
import { buildResumeCommand } from "./resumeCommand.js";

describe("buildResumeCommand", () => {
  it("builds Codex resume commands from Worker session metadata", () => {
    expect(
      buildResumeCommand({
        kind: "codex",
        baseCommand: "codexyoloproxy",
        resumeId: "resume-42"
      })
    ).toBe("codexyoloproxy resume resume-42");
  });

  it("returns null when there is no resume id", () => {
    expect(
      buildResumeCommand({
        kind: "codex",
        baseCommand: "codexyoloproxy",
        resumeId: null
      })
    ).toBeNull();
  });
});
