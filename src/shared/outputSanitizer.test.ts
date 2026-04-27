import { describe, expect, it } from "vitest";
import { filterKnownPlatformNoise } from "./outputSanitizer.js";

describe("filterKnownPlatformNoise", () => {
  it("removes macOS Codex malloc stack logging stderr lines", () => {
    expect(
      filterKnownPlatformNoise(
        [
          "worker started",
          "  codex(84652) MallocStackLogging: can't turn off malloc stack logging because it was not enabled.",
          "worker completed"
        ].join("\n")
      )
    ).toBe(["worker started", "worker completed"].join("\n"));
  });

  it("keeps unrelated stderr and similar diagnostic text", () => {
    const output = [
      "codex failed with a real error",
      "node(12) MallocStackLogging: can't turn off malloc stack logging because it was not enabled.",
      "codex(84652) MallocStackLogging: different message"
    ].join("\n");

    expect(filterKnownPlatformNoise(output)).toBe(output);
  });
});
