import { describe, expect, it } from "vitest";
import type { ExecutionNode } from "../../shared/types.js";
import { probeRemoteExecutionNode, type RemoteCommandRunner } from "./remoteNodeProbe.js";

class CapturingRemoteRunner implements RemoteCommandRunner {
  readonly inputs: Array<{ sshHost: string; remoteScript: string }> = [];

  constructor(private readonly result: { exitCode: number; stdout: string; stderr: string }) {}

  async run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.inputs.push(input);
    return this.result;
  }
}

describe("probeRemoteExecutionNode", () => {
  it("checks ssh reachability, workRoot, and codex command availability without local CPU work", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 0, stdout: "/usr/local/bin/codex\n", stderr: "" });

    const result = await probeRemoteExecutionNode({
      node: remoteNode({
        sshHost: "worker@builder.internal",
        workRoot: "/srv/agent fleet/work"
      }),
      codexCommand: "codex",
      runner
    });

    expect(runner.inputs).toEqual([
      {
        sshHost: "worker@builder.internal",
        remoteScript:
          "test -d '/srv/agent fleet/work' && command -v 'codex' >/dev/null 2>&1"
      }
    ]);
    expect(result).toEqual({
      ready: true,
      reasons: [],
      checks: {
        sshHost: "worker@builder.internal",
        workRoot: "/srv/agent fleet/work",
        codexCommand: "codex"
      }
    });
  });

  it("normalizes default remote scratch roots before probing", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 0, stdout: "/usr/local/bin/codex\n", stderr: "" });

    const result = await probeRemoteExecutionNode({
      node: remoteNode({
        workRoot: "/tmp/agent-fleet"
      }),
      codexCommand: "codex",
      runner
    });

    expect(runner.inputs[0].remoteScript).toBe(
      "test -d '/tmp/agent-fleet/work' && command -v 'codex' >/dev/null 2>&1"
    );
    expect(result.checks.workRoot).toBe("/tmp/agent-fleet/work");
  });

  it("returns readiness reasons without ssh when static node facts are incomplete", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 0, stdout: "", stderr: "" });

    const result = await probeRemoteExecutionNode({
      node: remoteNode({
        status: "unknown",
        sshHost: null,
        workRoot: "relative/work"
      }),
      codexCommand: "codex",
      runner
    });

    expect(runner.inputs).toEqual([]);
    expect(result).toEqual({
      ready: false,
      reasons: ["node status is unknown", "ssh host is required", "work root must be an absolute path"],
      checks: {
        sshHost: null,
        workRoot: "relative/work",
        codexCommand: "codex"
      }
    });
  });

  it("does not include proxy secrets in probe output", async () => {
    const runner = new CapturingRemoteRunner({
      exitCode: 1,
      stdout: "",
      stderr: "command not found"
    });

    const result = await probeRemoteExecutionNode({
      node: remoteNode({
        proxyUrl: "http://token:secret@127.0.0.1:1080"
      }),
      codexCommand: "codex",
      runner
    });

    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(["remote workRoot or codex command check failed"]);
  });
});

function remoteNode(overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: "node-1",
    name: "builder",
    kind: "remote",
    status: "ready",
    sshHost: "worker@builder.internal",
    workRoot: "/srv/agent-fleet",
    proxyUrl: null,
    tags: ["remote"],
    capacity: 2,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides
  };
}
