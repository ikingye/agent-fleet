import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../services/commandRunner.js";
import { GitHubClient } from "./githubClient.js";

class MockCommandRunner implements CommandRunner {
  async run(): Promise<CommandResult> {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        title: "Add dashboard",
        body: "Build the local dashboard",
        url: "https://github.com/ikingye/agent-fleet/issues/1"
      }),
      stderr: ""
    };
  }
}

describe("GitHubClient", () => {
  it("imports a GitHub issue through gh", async () => {
    const runner = new MockCommandRunner();
    const client = new GitHubClient(runner);

    await expect(client.getIssue("ikingye/agent-fleet", 1)).resolves.toEqual({
      title: "Add dashboard",
      goal: "Build the local dashboard",
      url: "https://github.com/ikingye/agent-fleet/issues/1"
    });
  });
});
