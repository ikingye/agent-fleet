import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandWorkerAdapter } from "./commandWorkerAdapter.js";

describe("CommandWorkerAdapter", () => {
  it("marks the Worker session failed when the requested command is unavailable", async () => {
    const adapter = new CommandWorkerAdapter("definitely-missing-agent-fleet-worker");

    const result = await adapter.start({
      goalTitle: "Bootstrap self",
      prompt: "Build the first Steward loop.",
      cwd: "/tmp/agent-fleet"
    });

    expect(result.status).toBe("failed");
    expect(result.resumeId).toBeNull();
    expect(result.initialOutput).toContain("Worker command not found");
  });

  it("runs an available Worker command and extracts a resume id from output", async () => {
    const adapter = new CommandWorkerAdapter(process.execPath, [
      "-e",
      "process.stdin.resume(); process.stdin.on('end', () => { console.log('resume id: worker-resume-42'); console.log('accepted prompt'); });"
    ]);

    const result = await adapter.start({
      goalTitle: "Bootstrap self",
      prompt: "Build the first Steward loop.",
      cwd: process.cwd()
    });

    expect(result.status).toBe("completed");
    expect(result.resumeId).toBe("worker-resume-42");
    expect(result.initialOutput).toContain("accepted prompt");
    expect(result.pid).toEqual(expect.any(Number));
  });

  it("runs a zsh alias when the Worker command is an interactive shell alias", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-alias-"));
    const originalHome = process.env.HOME;

    try {
      const scriptPath = join(dir, "aliased-worker.mjs");
      await writeFile(
        scriptPath,
        [
          "#!/usr/bin/env node",
          "process.stdin.resume();",
          "process.stdin.on('end', () => {",
          "  console.log('resume id: alias-resume-7');",
          "  console.log('alias accepted prompt');",
          "});"
        ].join("\n")
      );
      await chmod(scriptPath, 0o755);
      await writeFile(join(dir, ".zshrc"), `alias agentfleetalias='${process.execPath} ${scriptPath}'\n`);
      process.env.HOME = dir;

      const adapter = new CommandWorkerAdapter("agentfleetalias");
      const result = await adapter.start({
        goalTitle: "Alias worker",
        prompt: "Run through zsh alias.",
        cwd: process.cwd()
      });

      expect(result.status).toBe("completed");
      expect(result.resumeId).toBe("alias-resume-7");
      expect(result.initialOutput).toContain("alias accepted prompt");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
