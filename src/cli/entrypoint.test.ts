import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isCliEntrypoint } from "./entrypoint.js";

describe("isCliEntrypoint", () => {
  it("recognizes an installed steward bin symlink as the CLI entrypoint", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-cli-"));

    try {
      const realEntry = join(dir, "lib", "node_modules", "agent-fleet", "dist", "cli", "main.js");
      const binDir = join(dir, "bin");
      const stewardBin = join(binDir, "steward");

      mkdirSync(join(dir, "lib", "node_modules", "agent-fleet", "dist", "cli"), { recursive: true });
      mkdirSync(binDir, { recursive: true });
      writeFileSync(realEntry, "#!/usr/bin/env node\n");
      symlinkSync(realEntry, stewardBin);

      expect(isCliEntrypoint(pathToFileURL(realEntry).href, stewardBin)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
