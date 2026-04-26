import { describe, expect, it } from "vitest";
import type { ExecutionNode } from "../../shared/types.js";
import { normalizeRemoteWorkRoot } from "./remotePaths.js";
import { runRemoteNodeOnboarding, type RemoteCommandRunner } from "./remoteNodeOnboarding.js";

class CapturingRemoteRunner implements RemoteCommandRunner {
  readonly inputs: Array<{ sshHost: string; remoteScript: string }> = [];

  constructor(private readonly result: { exitCode: number; stdout: string; stderr: string }) {}

  async run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.inputs.push(input);
    return this.result;
  }
}

describe("runRemoteNodeOnboarding", () => {
  it("normalizes remote work roots to /tmp/agent-fleet/work", async () => {
    const runner = new CapturingRemoteRunner({
      exitCode: 0,
      stdout: [
        "AF_CHECK\tssh\tpass\tSSH command execution succeeded.",
        "AF_CHECK\tworkRoot\tpass\tRemote work directory structure is writable.",
        "AF_CHECK\tcodex\tpass\tCodex command is installed and logged in.",
        "AF_CHECK\tgit\tpass\tGit command is available.",
        "AF_CHECK\tgithubSsh\tpass\tGitHub SSH auth smoke succeeded.",
        "AF_CHECK\tproxy\tpass\tConfigured proxy is reachable at 127.0.0.1:1080."
      ].join("\n"),
      stderr: ""
    });

    const result = await runRemoteNodeOnboarding({
      node: remoteNode({
        workRoot: "/tmp/agent-fleet",
        proxyUrl: "http://token:secret@127.0.0.1:1080"
      }),
      codexCommand: "codex",
      runner
    });

    expect(result.ready).toBe(true);
    expect(result.normalizedWorkRoot).toBe("/tmp/agent-fleet/work");
    expect(result.checks.map((check) => check.id)).toEqual([
      "ssh",
      "workRoot",
      "codex",
      "git",
      "githubSsh",
      "proxy"
    ]);
    expect(runner.inputs[0]).toMatchObject({ sshHost: "worker@builder.internal" });
    expect(runner.inputs[0].remoteScript).toContain("WORK_ROOT='/tmp/agent-fleet/work'");
    expect(runner.inputs[0].remoteScript).toContain("PROXY_REQUIRED='1'");
    expect(runner.inputs[0].remoteScript).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports missing prerequisites without running ssh", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 0, stdout: "", stderr: "" });

    const result = await runRemoteNodeOnboarding({
      node: remoteNode({
        status: "unknown",
        sshHost: null,
        workRoot: "relative/work"
      }),
      codexCommand: "codex",
      runner
    });

    expect(runner.inputs).toEqual([]);
    expect(result.ready).toBe(false);
    expect(result.checks).toEqual([
      {
        id: "configuration",
        label: "Remote node configuration",
        status: "fail",
        summary: "node status is unknown; ssh host is required; work root must be an absolute path"
      }
    ]);
  });

  it("turns ssh runner failure into a sanitized ssh reachability failure", async () => {
    const runner = new CapturingRemoteRunner({
      exitCode: 255,
      stdout: "",
      stderr: "Permission denied (publickey). token:secret"
    });

    const result = await runRemoteNodeOnboarding({
      node: remoteNode(),
      codexCommand: "codex",
      runner
    });

    expect(result.ready).toBe(false);
    expect(result.checks[0]).toEqual({
      id: "ssh",
      label: "SSH reachability",
      status: "fail",
      summary: "SSH command could not complete on the remote node."
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("adds ssh.github.com:443 guidance when github.com ssh output is suspicious", async () => {
    const runner = new CapturingRemoteRunner({
      exitCode: 0,
      stdout: [
        "AF_CHECK\tssh\tpass\tSSH command execution succeeded.",
        "AF_CHECK\tworkRoot\tpass\tRemote work directory structure is writable.",
        "AF_CHECK\tcodex\tpass\tCodex command is installed and logged in.",
        "AF_CHECK\tgit\tpass\tGit command is available.",
        "AF_CHECK\tgithubSsh\tfail\tGitHub SSH on github.com looks blocked or host-key suspicious. Try ssh -T -p 443 git@ssh.github.com.",
        "AF_CHECK\tproxy\tpass\tNo proxy configured."
      ].join("\n"),
      stderr: ""
    });

    const result = await runRemoteNodeOnboarding({
      node: remoteNode(),
      codexCommand: "codex",
      runner
    });

    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "githubSsh")).toEqual({
      id: "githubSsh",
      label: "GitHub SSH auth",
      status: "fail",
      summary:
        "GitHub SSH on github.com looks blocked or host-key suspicious. Try ssh -T -p 443 git@ssh.github.com."
    });
  });
});

describe("normalizeRemoteWorkRoot", () => {
  it("uses /tmp/agent-fleet/work for the default scratch root and existing work child", () => {
    expect(normalizeRemoteWorkRoot("/tmp/agent-fleet")).toBe("/tmp/agent-fleet/work");
    expect(normalizeRemoteWorkRoot("/tmp/agent-fleet/")).toBe("/tmp/agent-fleet/work");
    expect(normalizeRemoteWorkRoot("/tmp/agent-fleet/work")).toBe("/tmp/agent-fleet/work");
  });
});

function remoteNode(overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: "node-1",
    name: "builder",
    kind: "remote",
    status: "ready",
    sshHost: "worker@builder.internal",
    workRoot: "/tmp/agent-fleet/work",
    proxyUrl: null,
    tags: ["remote"],
    capacity: 2,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides
  };
}
