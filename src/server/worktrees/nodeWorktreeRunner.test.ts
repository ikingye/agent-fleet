import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeWorktreeRunner } from "./nodeWorktreeRunner.js";

describe("createNodeWorktreeRunner", () => {
  it("checks paths, creates directories, and captures command output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-worktree-runner-"));

    try {
      const runner = createNodeWorktreeRunner(dir);
      const nested = join(dir, "nested", "worktrees");

      expect(await runner.pathExists(nested)).toBe(false);

      await runner.ensureDir(nested);

      expect(await runner.pathExists(nested)).toBe(true);
      await expect(runner.run(process.execPath, ["-e", "console.log('ok'); console.error('warn')"])).resolves.toEqual(
        {
          exitCode: 0,
          stdout: "ok\n",
          stderr: "warn\n"
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
