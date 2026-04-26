import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./createApp.js";
import type { RemoteCommandRunner } from "../remote/remoteNodeProbe.js";
import type { RemoteWorkspaceProvisioner } from "../remote/remoteWorkspaceProvisioner.js";
import type { WorkerAdapter } from "../workers/commandWorkerAdapter.js";
import type { SshWorkerProcessInput, SshWorkerProcessResult, SshWorkerProcessRunner } from "../workers/sshWorkerAdapter.js";

const fakeWorkerAdapter: WorkerAdapter = {
  kind: "codex",
  async start(input) {
    return {
      command: "codexyoloproxy",
      cwd: input.cwd,
      resumeId: "resume-api-test",
      pid: 4242,
      status: "running",
      initialOutput: "Worker started"
    };
  }
};

function countingWorkerAdapter() {
  let starts = 0;
  const adapter: WorkerAdapter = {
    kind: "codex",
    async start(input) {
      starts += 1;

      return {
        command: "codexyoloproxy",
        cwd: input.cwd,
        resumeId: `resume-message-loop-${starts}`,
        pid: 4242 + starts,
        status: "running",
        initialOutput: "Worker started"
      };
    }
  };

  return {
    adapter,
    starts: () => starts
  };
}

class CapturingSshRunner implements SshWorkerProcessRunner {
  readonly inputs: SshWorkerProcessInput[] = [];

  constructor(private readonly result: SshWorkerProcessResult) {}

  async run(input: SshWorkerProcessInput): Promise<SshWorkerProcessResult> {
    this.inputs.push(input);
    return this.result;
  }
}

class CapturingRemoteCommandRunner implements RemoteCommandRunner {
  readonly inputs: Array<{ sshHost: string; remoteScript: string }> = [];

  constructor(private readonly result: { exitCode: number; stdout: string; stderr: string }) {}

  async run(input: { sshHost: string; remoteScript: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.inputs.push(input);
    return this.result;
  }
}

const preparedRemoteWorkspaceProvisioner: RemoteWorkspaceProvisioner = {
  async provision() {
    return {
      status: "prepared",
      summary: "Remote workspace prepared by test provisioner.",
      actions: ["Ensured remote cwd exists"]
    };
  }
};

describe("API routes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-fleet-api-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a goal and exposes Steward decisions and Worker sessions on the dashboard", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      defaultRepositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const goalResponse = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Bootstrap agent-fleet",
          body: "Build a Steward Agent control plane."
        }
      });

      expect(goalResponse.statusCode).toBe(200);

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });
      const dashboard = dashboardResponse.json();

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboard.goals[0].status).toBe("running");
      expect(dashboard.decisions[0]).toMatchObject({
        title: "Start Worker Agent for goal",
        needsHumanReview: true
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        command: "codexyoloproxy",
        cwd: "/projects/agent-fleet",
        status: "running"
      });
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        workerSessionId: dashboard.workerSessions[0].id,
        repositoryPath: "/projects/agent-fleet",
        worktreePath: `/repo/agent-fleet/.worktrees/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        branchName: `agent-fleet/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        status: "planned"
      });
    } finally {
      await app.close();
    }
  });

  it("passes configured Worker args to the command adapter", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: process.execPath,
      workerArgs: [
        "-e",
        [
          "if (process.argv[1] !== 'configured arg') {",
          "  console.error(`unexpected arg: ${process.argv[1]}`);",
          "  process.exit(1);",
          "}",
          "process.stdin.resume();",
          "process.stdin.on('end', () => console.log('resume id: configured-worker-args'));"
        ].join(" "),
        "configured arg"
      ],
      defaultWorkerCwd: "/worktrees/agent-fleet"
    });

    try {
      const goalResponse = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: dir,
          title: "Configure Worker args",
          body: "Launch Codex non-interactively."
        }
      });

      expect(goalResponse.statusCode).toBe(200);

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(dashboard.workerSessions[0]).toMatchObject({
        command: expect.stringContaining("configured arg"),
        cwd: dir,
        resumeId: "configured-worker-args",
        status: "completed"
      });
    } finally {
      await app.close();
    }
  });

  it("requires workspacePath when accepting a new goal", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const goalResponse = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          title: "Bootstrap agent-fleet",
          body: "Build a Steward Agent control plane."
        }
      });

      expect(goalResponse.statusCode).toBe(400);
      expect(goalResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "workspacePath must be a non-empty string"
      });
    } finally {
      await app.close();
    }
  });

  it("records owner Steward chat messages and persists deterministic Steward responses", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "mahjong",
          workspacePath: "/Users/yewang/code/project/mahjong",
          title: "Fix tile rendering",
          body: "Investigate the current UI bug."
        }
      });

      const messageResponse = await app.inject({
        method: "POST",
        url: "/api/steward/messages",
        payload: {
          projectName: "mahjong",
          workspacePath: "/Users/yewang/code/project/mahjong",
          body: "What is the current recovery state?"
        }
      });

      expect(messageResponse.statusCode).toBe(200);
      expect(messageResponse.json().ownerMessage).toMatchObject({
        role: "owner",
        projectName: "mahjong",
        workspacePath: "/Users/yewang/code/project/mahjong",
        body: "What is the current recovery state?"
      });
      expect(messageResponse.json().stewardMessage).toMatchObject({
        role: "steward",
        projectName: "mahjong",
        workspacePath: "/Users/yewang/code/project/mahjong"
      });
      expect(messageResponse.json().stewardMessage.body).toContain("/Users/yewang/code/project/mahjong");
      expect(messageResponse.json().stewardMessage.body).toContain("1 active goal");

      const listResponse = await app.inject({
        method: "GET",
        url: "/api/steward/messages?workspacePath=%2FUsers%2Fyewang%2Fcode%2Fproject%2Fmahjong"
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().messages).toHaveLength(2);
      expect(dashboard.stewardMessages).toHaveLength(2);
      expect(dashboard.stewardMessages.map((message: { role: string }) => message.role)).toEqual(["owner", "steward"]);
    } finally {
      await app.close();
    }
  });

  it("turns an actionable Steward chat message into a goal and dispatches one Worker", async () => {
    const worker = countingWorkerAdapter();
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: worker.adapter
    });

    try {
      const messageResponse = await app.inject({
        method: "POST",
        url: "/api/steward/messages",
        payload: {
          projectName: "mahjong",
          workspacePath: "/Users/yewang/code/project/mahjong",
          body: "Build a deterministic scoring summary panel for the Mahjong app and verify it."
        }
      });

      expect(messageResponse.statusCode).toBe(200);
      expect(worker.starts()).toBe(1);

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const goal = dashboard.goals[0];

      expect(goal).toMatchObject({
        projectName: "mahjong",
        workspacePath: "/Users/yewang/code/project/mahjong",
        title: "Build a deterministic scoring summary panel",
        status: "running"
      });
      expect(dashboard.workerSessions).toHaveLength(1);
      expect(dashboard.workerSessions[0]).toMatchObject({
        goalId: goal.id,
        cwd: "/Users/yewang/code/project/mahjong",
        status: "running"
      });
      expect(messageResponse.json().stewardMessage).toMatchObject({
        role: "steward",
        projectName: "mahjong",
        workspacePath: "/Users/yewang/code/project/mahjong",
        goalId: goal.id
      });
      expect(messageResponse.json().stewardMessage.body).toContain(`Created goal ${goal.id}`);
      expect(messageResponse.json().stewardMessage.body).toContain("Build a deterministic scoring summary panel");
      expect(messageResponse.json().stewardMessage.body).toContain("Worker dispatched");
    } finally {
      await app.close();
    }
  });

  it("answers a status-oriented Steward chat message without dispatching a Worker", async () => {
    const worker = countingWorkerAdapter();
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: worker.adapter
    });

    try {
      const messageResponse = await app.inject({
        method: "POST",
        url: "/api/steward/messages",
        payload: {
          projectName: "mahjong",
          workspacePath: "/Users/yewang/code/project/mahjong",
          body: "What is the current recovery status for this workspace?"
        }
      });

      expect(messageResponse.statusCode).toBe(200);
      expect(worker.starts()).toBe(0);
      expect(messageResponse.json().stewardMessage.body).toContain("0 active goals");
      expect(messageResponse.json().stewardMessage.body).toContain("Recovery next action");

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      expect(dashboard.goals).toHaveLength(0);
      expect(dashboard.workerSessions).toHaveLength(0);
      expect(dashboard.stewardMessages.map((message: { role: string }) => message.role)).toEqual(["owner", "steward"]);
    } finally {
      await app.close();
    }
  });

  it("records an active goal update without duplicating the existing Worker dispatch", async () => {
    const worker = countingWorkerAdapter();
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: worker.adapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Implement Steward loop",
          body: "Build the first production-ready owner-message loop."
        }
      });
      const before = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const goalId = before.goals[0].id;

      const messageResponse = await app.inject({
        method: "POST",
        url: "/api/steward/messages",
        payload: {
          goalId,
          body: "Correction: keep this goal focused on API loop tests before UI polish."
        }
      });

      expect(messageResponse.statusCode).toBe(200);
      expect(worker.starts()).toBe(1);

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      expect(dashboard.workerSessions).toHaveLength(1);
      expect(dashboard.decisions).toHaveLength(before.decisions.length + 1);
      expect(dashboard.decisions.at(-1)).toMatchObject({
        goalId,
        workerSessionId: before.workerSessions[0].id,
        title: "Record owner update for active goal",
        needsHumanReview: false
      });
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject({
        reason: "correction",
        goalIds: [goalId],
        workerSessionIds: [before.workerSessions[0].id]
      });
      expect(messageResponse.json().stewardMessage.body).toContain("Owner update recorded");
      expect(messageResponse.json().stewardMessage.body).toContain("Active Worker already exists");
    } finally {
      await app.close();
    }
  });

  it("surfaces missing codexyoloproxy as a failed Worker session", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      defaultWorkerCwd: process.cwd(),
      defaultRepositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      workerAdapter: {
        kind: "codex",
        async start(input) {
          return {
            command: "codexyoloproxy",
            cwd: input.cwd,
            resumeId: null,
            pid: null,
            status: "failed",
            initialOutput: "Worker command not found: codexyoloproxy"
          };
        }
      }
    });

    try {
      const goalResponse = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Verify command availability",
          body: "Surface missing codexyoloproxy honestly."
        }
      });

      expect(goalResponse.statusCode).toBe(200);
      expect(goalResponse.json()).toMatchObject({ status: "blocked" });

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const eventTypes = dashboard.events.map((event: { type: string }) => event.type);

      expect(dashboard.workerSessions[0]).toMatchObject({
        command: "codexyoloproxy",
        status: "failed",
        pid: null,
        resumeId: null,
        lastOutput: "Worker command not found: codexyoloproxy"
      });
      expect(eventTypes).toContain("worker.failed");
      expect(eventTypes).not.toContain("worker.started");
      expect(dashboard.stewardCheckpoints[0].nextAction).toContain(
        "Worker command not found: codexyoloproxy"
      );
    } finally {
      await app.close();
    }
  });

  it("records corrections through the API and returns updated memory", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Bootstrap agent-fleet",
          body: "Build a Steward Agent control plane."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const decisionId = dashboard.decisions[0].id;

      const correctionResponse = await app.inject({
        method: "POST",
        url: `/api/decisions/${decisionId}/corrections`,
        payload: {
          body: "Escalate irreversible merge decisions to me."
        }
      });

      expect(correctionResponse.statusCode).toBe(200);

      const updated = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      expect(updated.corrections[0]).toMatchObject({
        decisionId,
        body: "Escalate irreversible merge decisions to me."
      });
      expect(updated.memories[0]).toMatchObject({
        key: "preference:decision-review:high-impact",
        value: "Escalate irreversible merge decisions to me."
      });
    } finally {
      await app.close();
    }
  });

  it("updates Worker session lifecycle status through the API", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Supervise Worker sessions",
          body: "Keep Worker lifecycle status durable."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const workerSessionId = dashboard.workerSessions[0].id;

      const statusResponse = await app.inject({
        method: "POST",
        url: `/api/worker-sessions/${workerSessionId}/status`,
        payload: {
          status: "completed",
          lastOutput: "Worker finished npm run check"
        }
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        workerSession: {
          id: workerSessionId,
          status: "completed",
          lastOutput: "Worker finished npm run check"
        }
      });

      const updated = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      expect(updated.workerSessions[0]).toMatchObject({
        id: workerSessionId,
        status: "completed",
        lastOutput: "Worker finished npm run check"
      });
      expect(updated.events.map((event: { type: string }) => event.type)).toContain("worker.status.updated");
    } finally {
      await app.close();
    }
  });

  it("records Steward checkpoints through the API and exposes a recovery report", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/repo/agent-fleet/.worktrees/recovery",
      defaultRepositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Recover Steward context",
          body: "Make compact failures recoverable from durable state."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const goalId = dashboard.goals[0].id;
      const workerSessionId = dashboard.workerSessions[0].id;

      const checkpointResponse = await app.inject({
        method: "POST",
        url: "/api/steward-checkpoints",
        payload: {
          reason: "crash",
          summary: "Main Steward session disconnected during compact.",
          nextAction: "Read the recovery report and resume the running Worker Agent.",
          goalIds: [goalId],
          workerSessionIds: [workerSessionId]
        }
      });

      expect(checkpointResponse.statusCode).toBe(200);
      expect(checkpointResponse.json()).toMatchObject({
        reason: "crash",
        summary: "Main Steward session disconnected during compact.",
        goalIds: [goalId],
        workerSessionIds: [workerSessionId]
      });

      const recoveryResponse = await app.inject({ method: "GET", url: "/api/recovery" });
      const recovery = recoveryResponse.json();

      expect(recoveryResponse.statusCode).toBe(200);
      expect(recovery.lastCheckpoint).toMatchObject({
        reason: "crash",
        nextAction: "Read the recovery report and resume the running Worker Agent."
      });
      expect(recovery.activeGoalIds).toEqual([goalId]);
      expect(recovery.activeGoals[0]).toMatchObject({
        id: goalId,
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Recover Steward context",
        status: "running"
      });
      expect(recovery.activeWorkerSessions[0]).toMatchObject({
        id: workerSessionId,
        resumeId: "resume-api-test",
        resumeCommand: "codexyoloproxy resume resume-api-test",
        worktreeAssignmentId: dashboard.worktreeAssignments[0].id,
        repositoryPath: "/projects/agent-fleet",
        worktreeStatus: "planned",
        worktreePath: `/repo/agent-fleet/.worktrees/${workerSessionId}-recover-steward-context`
      });
      expect(recovery.nextActions[0]).toBe("Checkpoint: Read the recovery report and resume the running Worker Agent.");
    } finally {
      await app.close();
    }
  });

  it("reconciles stale local Worker sessions without killing processes", async () => {
    let starts = 0;
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: {
        kind: "codex",
        async start(input) {
          starts += 1;

          return {
            command: starts === 1 ? "codex exec --json --sandbox workspace-write -" : "codexyoloproxy",
            cwd: input.cwd,
            resumeId: starts === 1 ? "resume-reconcile" : null,
            pid: starts === 1 ? 4242 : 4343,
            status: "running",
            initialOutput: "Worker started"
          };
        }
      },
      async workerProcessProbe(session) {
        return {
          status: "missing",
          message: `pid ${session.pid} is no longer running`
        };
      }
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Resume stale Worker",
          body: "Recover a resumable Worker session."
        }
      });
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Fail stale Worker",
          body: "Recover a non-resumable Worker session."
        }
      });

      const reconcileResponse = await app.inject({
        method: "POST",
        url: "/api/recovery/reconcile"
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(reconcileResponse.statusCode).toBe(200);
      expect(reconcileResponse.json()).toEqual({
        checked: 2,
        updated: 2,
        staleSessionIds: [dashboard.workerSessions[0].id, dashboard.workerSessions[1].id],
        runningSessionIds: []
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        status: "paused",
        resumeId: "resume-reconcile",
        lastOutput: "pid 4242 is no longer running"
      });
      expect(dashboard.workerSessions[1]).toMatchObject({
        status: "failed",
        resumeId: null,
        lastOutput: "pid 4343 is no longer running"
      });
      expect(dashboard.goals[0]).toMatchObject({ status: "blocked" });
      expect(dashboard.goals[1]).toMatchObject({ status: "blocked" });

      const recovery = (await app.inject({ method: "GET", url: "/api/recovery" })).json();
      expect(recovery.activeGoals).toEqual([
        expect.objectContaining({ id: dashboard.goals[0].id, status: "blocked" }),
        expect.objectContaining({ id: dashboard.goals[1].id, status: "blocked" })
      ]);
      expect(recovery.activeWorkerSessions[0]).toMatchObject({
        status: "paused",
        resumeCommand: "codex exec --json --sandbox workspace-write resume resume-reconcile"
      });
      expect(recovery.lastCheckpoint).toMatchObject({
        reason: "recovery",
        summary: "Recovery reconcile checked 2 Worker sessions and updated 2.",
        goalIds: [dashboard.goals[0].id, dashboard.goals[1].id],
        workerSessionIds: [dashboard.workerSessions[0].id, dashboard.workerSessions[1].id]
      });
      expect(recovery.nextActions[0]).toBe(
        `Checkpoint: Review stale Worker sessions: ${dashboard.workerSessions[0].id}, ${dashboard.workerSessions[1].id}. Related goals were updated for owner recovery.`
      );
    } finally {
      await app.close();
    }
  });

  it("reconciles remote Worker sessions through the execution node sshHost", async () => {
    const sshRunner = new CapturingSshRunner({
      status: "running",
      output: "accepted remote goal\nresume id: remote-reconcile\nagent-fleet remote pid: 7777\n",
      pid: 7777
    });
    const remoteRunner = new CapturingRemoteCommandRunner({ exitCode: 1, stdout: "", stderr: "" });
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "fake-remote-worker",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      remoteWorkspaceProvisioner: preparedRemoteWorkspaceProvisioner,
      remoteSshWorkerRunner: sshRunner,
      remoteCommandRunner: remoteRunner
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "aicp-hhht-231",
          kind: "remote",
          status: "ready",
          sshHost: "aicp-hhht-231",
          workRoot: "/root/agent-fleet-workspaces",
          proxyUrl: null,
          tags: ["remote", "linux", "high-cpu"]
        }
      });
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Remote high CPU reconcile",
          body: "Run this high CPU Worker remotely, then reconcile its remote pid."
        }
      });
      const before = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      const reconcileResponse = await app.inject({
        method: "POST",
        url: "/api/recovery/reconcile"
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(reconcileResponse.statusCode).toBe(200);
      expect(remoteRunner.inputs).toEqual([
        {
          sshHost: "aicp-hhht-231",
          remoteScript: "kill -0 7777"
        }
      ]);
      expect(reconcileResponse.json()).toEqual({
        checked: 1,
        updated: 1,
        staleSessionIds: [before.workerSessions[0].id],
        runningSessionIds: []
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: before.executionNodes[0].id,
        pid: 7777,
        status: "paused",
        resumeId: "remote-reconcile",
        lastOutput: "remote pid 7777 is no longer running on aicp-hhht-231"
      });
      expect(dashboard.goals[0]).toMatchObject({ status: "blocked" });

      const recovery = (await app.inject({ method: "GET", url: "/api/recovery" })).json();
      expect(recovery.activeGoals[0]).toMatchObject({
        id: dashboard.goals[0].id,
        status: "blocked"
      });
    } finally {
      await app.close();
    }
  });

  it("reconciles a remote Worker without a resume id to failed and blocks the goal", async () => {
    const sshRunner = new CapturingSshRunner({
      status: "running",
      output: "accepted remote goal\nagent-fleet remote pid: 8888\n",
      pid: 8888
    });
    const remoteRunner = new CapturingRemoteCommandRunner({ exitCode: 1, stdout: "", stderr: "" });
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "fake-remote-worker",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      remoteWorkspaceProvisioner: preparedRemoteWorkspaceProvisioner,
      remoteSshWorkerRunner: sshRunner,
      remoteCommandRunner: remoteRunner
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "aicp-hhht-232",
          kind: "remote",
          status: "ready",
          sshHost: "aicp-hhht-232",
          workRoot: "/root/agent-fleet-workspaces",
          proxyUrl: null,
          tags: ["remote", "linux", "high-cpu"]
        }
      });
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Remote non resumable reconcile",
          body: "Run this high CPU Worker remotely, then reconcile a failed terminal state."
        }
      });
      const before = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      const reconcileResponse = await app.inject({
        method: "POST",
        url: "/api/recovery/reconcile"
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(reconcileResponse.statusCode).toBe(200);
      expect(reconcileResponse.json()).toEqual({
        checked: 1,
        updated: 1,
        staleSessionIds: [before.workerSessions[0].id],
        runningSessionIds: []
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: before.executionNodes[0].id,
        pid: 8888,
        status: "failed",
        resumeId: null,
        lastOutput: "remote pid 8888 is no longer running on aicp-hhht-232"
      });
      expect(dashboard.goals[0]).toMatchObject({ status: "blocked" });

      const recovery = (await app.inject({ method: "GET", url: "/api/recovery" })).json();
      expect(recovery.activeGoals[0]).toMatchObject({
        id: dashboard.goals[0].id,
        status: "blocked"
      });
      expect(recovery.activeWorkerSessions).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("runs an autonomy tick and records an auditable checkpoint without dispatching duplicate Workers", async () => {
    let starts = 0;
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: {
        kind: "codex",
        async start(input) {
          starts += 1;

          return {
            command: "codexyoloproxy",
            cwd: input.cwd,
            resumeId: "resume-autonomy",
            pid: 5151,
            status: "running",
            initialOutput: "Worker started"
          };
        }
      },
      async workerProcessProbe(session) {
        return {
          status: "missing",
          message: `pid ${session.pid} is no longer running`
        };
      }
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Autonomy reconcile",
          body: "Reconcile existing Workers without dispatching new ones."
        }
      });
      const before = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      const autonomyResponse = await app.inject({
        method: "POST",
        url: "/api/steward/autonomy/run"
      });
      const body = autonomyResponse.json();
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(autonomyResponse.statusCode).toBe(200);
      expect(starts).toBe(1);
      expect(body.result).toMatchObject({
        checked: 1,
        updated: 1,
        decisionsRecorded: 0,
        handoffsQueued: 0,
        ownerReviewNeeded: 0
      });
      expect(body.checkpoint).toMatchObject({
        reason: "manual",
        summary: "Autonomy tick checked 1 Worker session, updated 1, recorded 0 decisions, queued 0 handoffs, flagged 0 owner reviews.",
        goalIds: [before.goals[0].id],
        workerSessionIds: [before.workerSessions[0].id]
      });
      expect(body.checkpoint.nextAction).toContain("Resume paused Worker session");
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject(body.checkpoint);
      expect(dashboard.workerSessions[0]).toMatchObject({
        status: "paused",
        lastOutput: "pid 5151 is no longer running"
      });
    } finally {
      await app.close();
    }
  });

  it("rejects invalid Steward checkpoint payloads", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const checkpointResponse = await app.inject({
        method: "POST",
        url: "/api/steward-checkpoints",
        payload: {
          reason: "unexpected",
          summary: "bad payload",
          nextAction: "bad payload",
          goalIds: [],
          workerSessionIds: []
        }
      });

      expect(checkpointResponse.statusCode).toBe(400);
      expect(checkpointResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "reason must be one of: dispatch, correction, recovery, crash, manual"
      });
    } finally {
      await app.close();
    }
  });

  it("rejects invalid Worker session lifecycle status updates", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codexyoloproxy",
      defaultWorkerCwd: "/worktrees/agent-fleet",
      workerAdapter: fakeWorkerAdapter
    });

    try {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Validate lifecycle updates",
          body: "Reject unknown Worker status values."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const workerSessionId = dashboard.workerSessions[0].id;

      const statusResponse = await app.inject({
        method: "POST",
        url: `/api/worker-sessions/${workerSessionId}/status`,
        payload: {
          status: "stale",
          lastOutput: "not a valid durable status"
        }
      });

      expect(statusResponse.statusCode).toBe(400);
      expect(statusResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "status must be one of: starting, running, paused, completed, failed"
      });
    } finally {
      await app.close();
    }
  });

  it("registers a remote execution node and exposes it on the dashboard", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "mac-mini-builder",
          kind: "remote",
          status: "unknown",
          sshHost: "worker@mac-mini.local",
          workRoot: "/Users/worker/agent-fleet",
          proxyUrl: "http://127.0.0.1:1080",
          tags: ["remote", "linux", "high-cpu"],
          capacity: 3
        }
      });

      expect(nodeResponse.statusCode).toBe(200);
      expect(nodeResponse.json()).toMatchObject({
        name: "mac-mini-builder",
        kind: "remote",
        status: "unknown",
        sshHost: "worker@mac-mini.local",
        workRoot: "/Users/worker/agent-fleet",
        proxyUrl: "http://127.0.0.1:1080",
        tags: ["remote", "linux", "high-cpu"],
        capacity: 3
      });

      const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });
      const dashboard = dashboardResponse.json();

      expect(dashboard.executionNodes).toHaveLength(1);
      expect(dashboard.executionNodes[0]).toMatchObject({
        name: "mac-mini-builder",
        kind: "remote",
        tags: ["remote", "linux", "high-cpu"],
        capacity: 3
      });
      expect(dashboard.events.map((event: { type: string }) => event.type)).toContain("execution_node.registered");
    } finally {
      await app.close();
    }
  });

  it("updates an execution node by name without creating dashboard duplicates", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const createdResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "linux-builder",
          kind: "remote",
          status: "unknown",
          sshHost: "worker@linux-builder.internal",
          workRoot: "/srv/agent-fleet",
          proxyUrl: null
        }
      });
      const created = createdResponse.json();

      const updatedResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "linux-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@linux-builder.internal",
          workRoot: "/srv/agent-fleet",
          proxyUrl: "http://127.0.0.1:1080"
        }
      });
      const updated = updatedResponse.json();

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(createdResponse.statusCode).toBe(200);
      expect(updatedResponse.statusCode).toBe(200);
      expect(updated.id).toBe(created.id);
      expect(updated).toMatchObject({
        status: "ready",
        proxyUrl: "http://127.0.0.1:1080"
      });
      expect(dashboard.executionNodes).toHaveLength(1);
      expect(dashboard.events.map((event: { type: string }) => event.type)).toEqual([
        "execution_node.registered",
        "execution_node.updated"
      ]);
    } finally {
      await app.close();
    }
  });

  it("defaults and normalizes stateless remote execution node work roots", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const defaultedResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "aicp-hhht-231",
          kind: "remote",
          status: "unknown",
          sshHost: "worker@aicp-hhht-231",
          proxyUrl: null
        }
      });
      const normalizedResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "aicp-hhht-232",
          kind: "remote",
          status: "unknown",
          sshHost: "worker@aicp-hhht-232",
          workRoot: "/tmp/agent-fleet/work/",
          proxyUrl: null
        }
      });

      expect(defaultedResponse.statusCode).toBe(200);
      expect(normalizedResponse.statusCode).toBe(200);
      expect(defaultedResponse.json()).toMatchObject({
        workRoot: "/tmp/agent-fleet/work"
      });
      expect(normalizedResponse.json()).toMatchObject({
        workRoot: "/tmp/agent-fleet/work"
      });
    } finally {
      await app.close();
    }
  });

  it("probes remote execution node readiness through a lightweight ssh command", async () => {
    const remoteRunner = new CapturingRemoteCommandRunner({
      exitCode: 0,
      stdout: "/usr/local/bin/codex\n",
      stderr: ""
    });
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codex",
      workerAdapter: fakeWorkerAdapter,
      remoteCommandRunner: remoteRunner
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "linux-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@linux-builder.internal",
          workRoot: "/srv/agent fleet",
          proxyUrl: null
        }
      });
      const node = nodeResponse.json();

      const probeResponse = await app.inject({
        method: "POST",
        url: `/api/execution-nodes/${node.id}/probe`
      });

      expect(probeResponse.statusCode).toBe(200);
      expect(remoteRunner.inputs).toEqual([
        {
          sshHost: "worker@linux-builder.internal",
          remoteScript: "test -d '/srv/agent fleet' && command -v 'codex' >/dev/null 2>&1"
        }
      ]);
      expect(probeResponse.json()).toEqual({
        ready: true,
        reasons: [],
        checks: {
          sshHost: "worker@linux-builder.internal",
          workRoot: "/srv/agent fleet",
          codexCommand: "codex"
        }
      });
    } finally {
      await app.close();
    }
  });

  it("runs remote onboarding readiness checks for a registered execution node", async () => {
    const remoteRunner = new CapturingRemoteCommandRunner({
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
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "codex",
      workerAdapter: fakeWorkerAdapter,
      remoteCommandRunner: remoteRunner
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "linux-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@linux-builder.internal",
          workRoot: "/tmp/agent-fleet",
          proxyUrl: "http://token:secret@127.0.0.1:1080"
        }
      });
      const node = nodeResponse.json();
      const onboardingResponse = await app.inject({
        method: "POST",
        url: `/api/execution-nodes/${node.id}/onboarding`
      });

      expect(onboardingResponse.statusCode).toBe(200);
      expect(onboardingResponse.json()).toMatchObject({
        nodeId: node.id,
        ready: true,
        normalizedWorkRoot: "/tmp/agent-fleet/work",
        checks: [
          { id: "ssh", status: "pass" },
          { id: "workRoot", status: "pass" },
          { id: "codex", status: "pass" },
          { id: "git", status: "pass" },
          { id: "githubSsh", status: "pass" },
          { id: "proxy", status: "pass" }
        ]
      });
      expect(JSON.stringify(onboardingResponse.json())).not.toContain("secret");
      expect(remoteRunner.inputs[0].remoteScript).not.toContain("secret");
    } finally {
      await app.close();
    }
  });

  it("exposes GitHub deploy-key lease acquire, list, renew, release, and expire endpoints", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "lease-builder",
          kind: "remote",
          status: "ready",
          sshHost: "worker@lease-builder.internal",
          workRoot: "/tmp/agent-fleet/work",
          proxyUrl: null
        }
      });
      const node = nodeResponse.json();

      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Remote lease worker one",
          body: "Use a shared deploy-key lease for the first remote Worker."
        }
      });
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Remote lease worker two",
          body: "Use the same shared deploy-key lease for the second remote Worker."
        }
      });

      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();
      const [workerOne, workerTwo] = dashboard.workerSessions;
      const acquirePayload = {
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        repositoryUrl: "git@github.com:owner/agent-fleet.git",
        repositorySlug: "owner-agent-fleet",
        githubDeployKeyId: "github-key-123",
        publicKeyFingerprint: "SHA256:project-key",
        localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
        remoteNodeId: node.id,
        remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key"
      };

      const firstAcquireResponse = await app.inject({
        method: "POST",
        url: "/api/github-deploy-key-leases/acquire",
        payload: {
          ...acquirePayload,
          workerSessionId: workerOne.id,
          expiresAt: "2026-04-26T10:10:00.000Z",
          now: "2026-04-26T10:00:00.000Z"
        }
      });
      const firstLease = firstAcquireResponse.json().lease;
      const secondAcquireResponse = await app.inject({
        method: "POST",
        url: "/api/github-deploy-key-leases/acquire",
        payload: {
          ...acquirePayload,
          workerSessionId: workerTwo.id,
          expiresAt: "2026-04-26T10:15:00.000Z",
          now: "2026-04-26T10:05:00.000Z"
        }
      });
      const sharedLease = secondAcquireResponse.json().lease;

      expect(firstAcquireResponse.statusCode).toBe(200);
      expect(secondAcquireResponse.statusCode).toBe(200);
      expect(sharedLease.id).toBe(firstLease.id);
      expect(sharedLease).toMatchObject({
        activeWorkerSessionIds: [workerOne.id, workerTwo.id],
        refcount: 2,
        status: "active",
        cleanupStatus: "not_requested",
        expiresAt: "2026-04-26T10:15:00.000Z",
        lastHeartbeatAt: "2026-04-26T10:05:00.000Z"
      });

      const listResponse = await app.inject({
        method: "GET",
        url: `/api/github-deploy-key-leases?workspacePath=${encodeURIComponent(
          "/projects/agent-fleet"
        )}&remoteNodeId=${node.id}&status=active`
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().leases).toEqual([expect.objectContaining({ id: firstLease.id })]);

      const renewResponse = await app.inject({
        method: "POST",
        url: `/api/github-deploy-key-leases/${sharedLease.id}/renew`,
        payload: {
          workerSessionId: workerOne.id,
          expiresAt: "2026-04-26T10:30:00.000Z",
          now: "2026-04-26T10:20:00.000Z"
        }
      });

      expect(renewResponse.statusCode).toBe(200);
      expect(renewResponse.json().lease).toMatchObject({
        refcount: 2,
        expiresAt: "2026-04-26T10:30:00.000Z",
        lastHeartbeatAt: "2026-04-26T10:20:00.000Z"
      });

      const releaseOneResponse = await app.inject({
        method: "POST",
        url: `/api/github-deploy-key-leases/${sharedLease.id}/release`,
        payload: {
          workerSessionId: workerOne.id,
          now: "2026-04-26T10:21:00.000Z"
        }
      });

      expect(releaseOneResponse.statusCode).toBe(200);
      expect(releaseOneResponse.json().lease).toMatchObject({
        activeWorkerSessionIds: [workerTwo.id],
        refcount: 1,
        status: "active",
        cleanupStatus: "not_requested"
      });

      const releaseTwoResponse = await app.inject({
        method: "POST",
        url: `/api/github-deploy-key-leases/${sharedLease.id}/release`,
        payload: {
          workerSessionId: workerTwo.id,
          now: "2026-04-26T10:22:00.000Z"
        }
      });

      expect(releaseTwoResponse.statusCode).toBe(200);
      expect(releaseTwoResponse.json().lease).toMatchObject({
        activeWorkerSessionIds: [],
        refcount: 0,
        status: "released",
        cleanupStatus: "pending"
      });

      const staleAcquireResponse = await app.inject({
        method: "POST",
        url: "/api/github-deploy-key-leases/acquire",
        payload: {
          ...acquirePayload,
          workerSessionId: workerOne.id,
          expiresAt: "2026-04-26T11:00:00.000Z",
          now: "2026-04-26T10:50:00.000Z"
        }
      });
      const staleLease = staleAcquireResponse.json().lease;
      const expireResponse = await app.inject({
        method: "POST",
        url: "/api/github-deploy-key-leases/expire",
        payload: {
          now: "2026-04-26T11:01:00.000Z"
        }
      });
      const staleListResponse = await app.inject({
        method: "GET",
        url: "/api/github-deploy-key-leases?status=stale"
      });

      expect(expireResponse.statusCode).toBe(200);
      expect(expireResponse.json()).toEqual({ expiredLeaseIds: [staleLease.id] });
      expect(staleListResponse.json().leases).toEqual([
        expect.objectContaining({
          id: staleLease.id,
          activeWorkerSessionIds: [],
          refcount: 0,
          status: "stale",
          cleanupStatus: "pending"
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it("validates GitHub deploy-key lease endpoint payloads", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const acquireResponse = await app.inject({
        method: "POST",
        url: "/api/github-deploy-key-leases/acquire",
        payload: {
          projectName: "",
          workspacePath: "/projects/agent-fleet",
          repositoryUrl: "git@github.com:owner/agent-fleet.git",
          repositorySlug: "owner-agent-fleet",
          githubDeployKeyId: null,
          publicKeyFingerprint: "SHA256:project-key",
          localPrivateKeyPath: "/projects/agent-fleet/.agent-fleet/secrets/owner-agent-fleet/github-deploy-key",
          remoteNodeId: "missing-node",
          remotePrivateKeyPath: "/tmp/agent-fleet/keys/owner-agent-fleet/github-deploy-key",
          workerSessionId: "missing-worker",
          expiresAt: "2026-04-26T10:10:00.000Z"
        }
      });
      const renewResponse = await app.inject({
        method: "POST",
        url: "/api/github-deploy-key-leases/missing-lease/renew",
        payload: {
          workerSessionId: "missing-worker",
          expiresAt: "not-a-date"
        }
      });

      expect(acquireResponse.statusCode).toBe(400);
      expect(acquireResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "projectName must be a non-empty string"
      });
      expect(renewResponse.statusCode).toBe(400);
      expect(renewResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "expiresAt must be a valid ISO date string"
      });
    } finally {
      await app.close();
    }
  });

  it("dispatches accepted goals to a ready remote execution node through SSH", async () => {
    const sshRunner = new CapturingSshRunner({
      status: "completed",
      output: "accepted remote goal\nresume id: remote-api-test\n",
      pid: 8686
    });
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerCommand: "fake-remote-worker",
      workerArgs: ["--safe-smoke"],
      defaultWorkerCwd: "/worktrees/agent-fleet",
      remoteWorkspaceProvisioner: preparedRemoteWorkspaceProvisioner,
      remoteSshWorkerRunner: sshRunner
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "aicp-hhht-231",
          kind: "remote",
          status: "ready",
          sshHost: "aicp-hhht-231",
          workRoot: "/root/agent-fleet-workspaces",
          proxyUrl: "http://127.0.0.1:1080",
          tags: ["remote", "linux", "high-cpu"]
        }
      });
      const node = nodeResponse.json();

      const goalResponse = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          projectName: "agent-fleet",
          workspacePath: "/projects/agent-fleet",
          title: "Remote build dispatch",
          body: "Use a safe fake Worker command for a high CPU build and test run."
        }
      });
      const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard" })).json();

      expect(nodeResponse.statusCode).toBe(200);
      expect(goalResponse.statusCode).toBe(200);
      expect(sshRunner.inputs).toHaveLength(1);
      expect(sshRunner.inputs[0]).toMatchObject({
        command: "ssh",
        stdin: expect.stringContaining("Goal: Remote build dispatch")
      });
      expect(sshRunner.inputs[0].stdin).toMatch(
        /^Worker Name: agent-fleet-remote-build-dispatch-remote-\d{12}\n/
      );
      expect(sshRunner.inputs[0].args.slice(0, -1)).toEqual(["aicp-hhht-231"]);
      expect(sshRunner.inputs[0].args.at(-1)).toContain(
        "cd '\\''/root/agent-fleet-workspaces/agent-fleet/agent-fleet'\\''"
      );
      expect(sshRunner.inputs[0].args.at(-1)).toContain("HTTPS_PROXY='\\''http://127.0.0.1:1080'\\''");
      expect(sshRunner.inputs[0].args.at(-1)).toContain("'\\''fake-remote-worker'\\''");
      expect(sshRunner.inputs[0].args.at(-1)).toContain("'\\''--safe-smoke'\\''");
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: node.id,
        command: "ssh aicp-hhht-231 fake-remote-worker --safe-smoke",
        cwd: "/root/agent-fleet-workspaces/agent-fleet/agent-fleet",
        resumeId: "remote-api-test",
        status: "completed"
      });
    } finally {
      await app.close();
    }
  });

  it("rejects ready remote execution nodes that are missing required readiness facts", async () => {
    const app = await createApp({
      statePath: join(dir, "state.json"),
      workerAdapter: fakeWorkerAdapter
    });

    try {
      const nodeResponse = await app.inject({
        method: "POST",
        url: "/api/execution-nodes",
        payload: {
          name: "broken-builder",
          kind: "remote",
          status: "ready",
          sshHost: null,
          workRoot: "relative/work",
          proxyUrl: null
        }
      });

      expect(nodeResponse.statusCode).toBe(400);
      expect(nodeResponse.json()).toMatchObject({
        error: "Bad Request",
        message: "Remote execution node is not ready: ssh host is required; work root must be an absolute path"
      });
    } finally {
      await app.close();
    }
  });
});
