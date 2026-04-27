import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./runCli.js";

function memoryStream() {
  let text = "";

  return {
    write(chunk: string) {
      text += chunk;
      return true;
    },
    text() {
      return text;
    }
  } as NodeJS.WriteStream & { text(): string };
}

describe("runCli provider config commands", () => {
  it("initializes, updates, and lists Worker providers without requiring the API server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-cli-config-"));
    const configPath = join(dir, "config.json");
    const stdout = memoryStream();
    const stderr = memoryStream();

    try {
      await expect(
        runCli(["config", "init", "--config", configPath], {}, dir, {
          stdin: process.stdin,
          stdout,
          stderr
        })
      ).resolves.toBe(0);
      await expect(
        runCli(
          [
            "providers",
            "set",
            "--config",
            configPath,
            "--id",
            "codex-main",
            "--type",
            "codex",
            "--command",
            "codex exec --model {model} --sandbox workspace-write -",
            "--model",
            "gpt-5-codex",
            "--tags",
            "high-cpu,review",
            "--priority",
            "200"
          ],
          {},
          dir,
          {
            stdin: process.stdin,
            stdout,
            stderr
          }
        )
      ).resolves.toBe(0);

      const listStdout = memoryStream();
      await expect(
        runCli(["providers", "list", "--config", configPath], {}, dir, {
          stdin: process.stdin,
          stdout: listStdout,
          stderr
        })
      ).resolves.toBe(0);

      expect(stderr.text()).toBe("");
      expect(listStdout.text()).toContain("codex-main");
      expect(listStdout.text()).toContain("gpt-5-codex");
      expect(listStdout.text()).toContain("high-cpu,review");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
