import { describe, expect, it } from "vitest";
import { probeRemoteWorkerPid, type RemoteCommandRunner } from "./remoteWorkerProbe.js";

class CapturingRemoteRunner implements RemoteCommandRunner {
  readonly inputs: Array<{ sshHost: string; remoteScript: string }> = [];

  constructor(private readonly result: { exitCode: number; stdout: string; stderr: string }) {}

  async run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.inputs.push(input);
    return this.result;
  }
}

describe("probeRemoteWorkerPid", () => {
  it("checks a remote Worker pid through ssh with a lightweight kill probe", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 0, stdout: "", stderr: "" });

    const result = await probeRemoteWorkerPid({
      sshHost: "worker@builder.internal",
      pid: 7777,
      runner
    });

    expect(runner.inputs).toEqual([
      {
        sshHost: "worker@builder.internal",
        remoteScript: "kill -0 7777"
      }
    ]);
    expect(result).toEqual({ status: "running" });
  });

  it("reports missing when the remote pid is no longer alive", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 1, stdout: "", stderr: "" });

    const result = await probeRemoteWorkerPid({
      sshHost: "worker@builder.internal",
      pid: 8888,
      runner
    });

    expect(result).toEqual({
      status: "missing",
      message: "remote pid 8888 is no longer running on worker@builder.internal"
    });
  });

  it("rejects invalid pid values before building a remote shell command", async () => {
    const runner = new CapturingRemoteRunner({ exitCode: 0, stdout: "", stderr: "" });

    await expect(
      probeRemoteWorkerPid({
        sshHost: "worker@builder.internal",
        pid: -1,
        runner
      })
    ).rejects.toThrow("pid must be a positive integer");
    expect(runner.inputs).toEqual([]);
  });
});
