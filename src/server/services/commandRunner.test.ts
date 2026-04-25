import { describe, expect, it } from "vitest";
import { createCommandRunner } from "./commandRunner.js";

describe("createCommandRunner", () => {
  it("runs a command and captures stdout", async () => {
    const runner = createCommandRunner();

    const result = await runner.run("node", ["-e", "console.log('ok')"], { cwd: process.cwd() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});
