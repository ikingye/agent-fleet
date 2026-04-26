import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ChildProcessSshWorkerRunner,
  RemoteSshWorkerAdapter,
  buildSshWorkerCommand,
  type SshWorkerProcessInput,
  type SshWorkerProcessResult,
  type SshWorkerProcessRunner
} from "./sshWorkerAdapter.js";

class CapturingRunner implements SshWorkerProcessRunner {
  readonly inputs: SshWorkerProcessInput[] = [];

  constructor(private readonly result: SshWorkerProcessResult) {}

  async run(input: SshWorkerProcessInput): Promise<SshWorkerProcessResult> {
    this.inputs.push(input);
    return this.result;
  }
}

describe("buildSshWorkerCommand", () => {
  it("builds local ssh argv and quotes cwd, proxy env, and Worker command for the remote shell", () => {
    const built = buildSshWorkerCommand({
      sshHost: "worker@example.com",
      sshArgs: ["-o", "BatchMode=yes"],
      cwd: "/srv/agent fleet/app;rm -rf /",
      workerCommand: "codexyoloproxy",
      workerArgs: ["--task", "say hi; reboot"],
      proxyEnv: {
        HTTPS_PROXY: "http://127.0.0.1:1080",
        NO_PROXY: "localhost,127.0.0.1"
      }
    });

    expect(built.command).toBe("ssh");
    expect(built.args.slice(0, -1)).toEqual(["-o", "BatchMode=yes", "worker@example.com"]);
    expect(built.args.at(-1)).toMatch(/^sh -lc '/);
    expect(built.args.at(-1)).toContain("cd '\\''/srv/agent fleet/app;rm -rf /'\\''");
    expect(built.args.at(-1)).toContain("HTTPS_PROXY='\\''http://127.0.0.1:1080'\\''");
    expect(built.args.at(-1)).toContain("NO_PROXY='\\''localhost,127.0.0.1'\\''");
    expect(built.args.at(-1)).toContain("'\\''codexyoloproxy'\\''");
    expect(built.args.at(-1)).toContain("'\\''--task'\\''");
    expect(built.args.at(-1)).toContain("'\\''say hi; reboot'\\''");
    expect(built.args.at(-1)).toContain("agent-fleet remote pid:");
    expect(built.args.at(-1)).toContain('wait "$agent_fleet_worker_pid"');
  });

  it("builds a syntactically valid remote shell wrapper", () => {
    const built = buildSshWorkerCommand({
      sshHost: "worker@example.com",
      cwd: "/tmp",
      workerCommand: "true"
    });

    expect(built.args.at(-1)).toContain('cat > "$agent_fleet_prompt_file"');
    expect(built.args.at(-1)).toContain('< "$agent_fleet_prompt_file" &');
    expect(built.args.at(-1)).toContain('wait "$agent_fleet_worker_pid"');
    expect(built.args.at(-1)).toContain('rm -f "$agent_fleet_prompt_file"');

    const syntaxCheck = spawnSync("sh", ["-c", built.remoteCommand], {
      encoding: "utf8"
    });

    expect(syntaxCheck.status).toBe(0);
    expect(syntaxCheck.stderr).toBe("");
  });

  it("passes a generic remote environment including GIT_SSH_COMMAND to the Worker command", () => {
    const built = buildSshWorkerCommand({
      sshHost: "worker@example.com",
      cwd: "/tmp/project",
      workerCommand: "codex",
      env: {
        GIT_SSH_COMMAND:
          "ssh -i /tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key -o IdentitiesOnly=yes -o HostName=ssh.github.com -o Port=443"
      }
    });

    expect(built.args.at(-1)).toContain(
      "GIT_SSH_COMMAND='\\''ssh -i /tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key -o IdentitiesOnly=yes -o HostName=ssh.github.com -o Port=443'\\''"
    );
    expect(built.displayCommand).not.toContain("GIT_SSH_COMMAND");
  });
});

describe("RemoteSshWorkerAdapter", () => {
  it("starts ssh through the runner, forwards prompt stdin, and extracts a resume id", async () => {
    const runner = new CapturingRunner({
      status: "completed",
      output: "accepted remote prompt\nresume id: ssh-resume-42\n",
      pid: 8080
    });
    const adapter = new RemoteSshWorkerAdapter({
      sshHost: "worker@builder.internal",
      workerCommand: "codexyoloproxy",
      workerArgs: ["--yolo"],
      startupTimeoutMs: 2500,
      runner
    });

    const result = await adapter.start({
      goalTitle: "Remote offload",
      prompt: "Implement the remote Worker adapter.",
      cwd: "/srv/agent-fleet/worktrees/remote"
    });

    expect(runner.inputs).toHaveLength(1);
    expect(runner.inputs[0]).toMatchObject({
      command: "ssh",
      stdin: "Implement the remote Worker adapter.",
      startupTimeoutMs: 2500
    });
    expect(runner.inputs[0]?.args[0]).toBe("worker@builder.internal");
    expect(result).toEqual({
      command: expect.stringContaining("ssh worker@builder.internal"),
      cwd: "/srv/agent-fleet/worktrees/remote",
      resumeId: "ssh-resume-42",
      pid: 8080,
      status: "completed",
      initialOutput: "accepted remote prompt\nresume id: ssh-resume-42\n"
    });
  });

  it("marks the Worker session failed when ssh reports a failed status", async () => {
    const runner = new CapturingRunner({
      status: "failed",
      output: "ssh: connect to host builder.internal port 22: Connection refused\nSSH worker process exited with code 255",
      pid: null
    });
    const adapter = new RemoteSshWorkerAdapter({
      sshHost: "worker@builder.internal",
      workerCommand: "codexyoloproxy",
      runner
    });

    const result = await adapter.start({
      goalTitle: "Remote offload",
      prompt: "Run remotely.",
      cwd: "/srv/agent-fleet/worktrees/remote"
    });

    expect(result.status).toBe("failed");
    expect(result.resumeId).toBeNull();
    expect(result.pid).toBeNull();
    expect(result.initialOutput).toContain("Connection refused");
    expect(result.initialOutput).toContain("code 255");
  });

  it("preserves a running startup-timeout status from the ssh runner", async () => {
    const runner = new CapturingRunner({
      status: "running",
      output: "Worker process started with pid 9090",
      pid: 9090
    });
    const adapter = new RemoteSshWorkerAdapter({
      sshHost: "worker@builder.internal",
      workerCommand: "codexyoloproxy",
      startupTimeoutMs: 10,
      runner
    });

    const result = await adapter.start({
      goalTitle: "Remote offload",
      prompt: "Run remotely.",
      cwd: "/srv/agent-fleet/worktrees/remote"
    });

    expect(runner.inputs[0]?.startupTimeoutMs).toBe(10);
    expect(result.status).toBe("running");
    expect(result.resumeId).toBeNull();
    expect(result.initialOutput).toBe("Worker process started with pid 9090");
  });

  it("extracts a remote pid marker when the runner leaves pid empty", async () => {
    const runner = new CapturingRunner({
      status: "running",
      output: "accepted remote prompt\nagent-fleet remote pid: 7070\n",
      pid: null
    });
    const adapter = new RemoteSshWorkerAdapter({
      sshHost: "worker@builder.internal",
      workerCommand: "codexyoloproxy",
      runner
    });

    const result = await adapter.start({
      goalTitle: "Remote offload",
      prompt: "Run remotely.",
      cwd: "/srv/agent-fleet/worktrees/remote"
    });

    expect(result.pid).toBe(7070);
  });
});

describe("ChildProcessSshWorkerRunner", () => {
  it("feeds stdin to a backgrounded Worker while still parsing the remote pid marker", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-fleet-ssh-worker-"));
    const previousTmpDir = process.env.TMPDIR;
    const built = buildSshWorkerCommand({
      sshHost: "worker@example.com",
      cwd: tempDir,
      workerCommand: process.execPath,
      workerArgs: [
        "-e",
        [
          "let data = '';",
          "process.stdin.setEncoding('utf8');",
          "process.stdin.on('data', (chunk) => { data += chunk; });",
          "process.stdin.on('end', () => { console.log('worker stdin: ' + data); });"
        ].join("")
      ]
    });

    try {
      process.env.TMPDIR = tempDir;

      const result = await new ChildProcessSshWorkerRunner().run({
        command: "sh",
        args: ["-c", built.remoteCommand],
        stdin: "Prompt from Steward stdin.\nSecond line.",
        startupTimeoutMs: 2000
      });

      expect(result.status).toBe("completed");
      expect(result.pid).toEqual(expect.any(Number));
      expect(result.output).toMatch(/agent-fleet remote pid: \d+/);
      expect(result.output).toContain("worker stdin: Prompt from Steward stdin.\nSecond line.");
      expect(readdirSync(tempDir).filter((entry) => entry.startsWith("agent-fleet-worker-stdin."))).toEqual([]);
    } finally {
      if (previousTmpDir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = previousTmpDir;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports the remote Worker pid marker instead of the local ssh client pid", async () => {
    const result = await new ChildProcessSshWorkerRunner().run({
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log('agent-fleet remote pid: 7777');",
          "setTimeout(() => {}, 1500);"
        ].join("")
      ],
      stdin: "",
      startupTimeoutMs: 500
    });

    expect(result.status).toBe("running");
    expect(result.pid).toBe(7777);
    expect(result.output).toContain("agent-fleet remote pid: 7777");
  });

  it("does not expose the local ssh client pid when no remote pid marker is available", async () => {
    const result = await new ChildProcessSshWorkerRunner().run({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 200);"],
      stdin: "",
      startupTimeoutMs: 20
    });

    expect(result.status).toBe("running");
    expect(result.pid).toBeNull();
    expect(result.output).toContain("Remote Worker pid was not reported");
    expect(result.output).toContain("local ssh client pid");
  });
});
