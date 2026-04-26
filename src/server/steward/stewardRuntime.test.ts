import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import type { MaterializeWorktreeRunner } from "../worktrees/worktreeManager.js";
import type {
  RemoteWorkspaceProvisioner,
  RemoteWorkspaceProvisionResult
} from "../remote/remoteWorkspaceProvisioner.js";
import { StewardRuntime } from "./stewardRuntime.js";
import type { WorkerAdapter } from "../workers/commandWorkerAdapter.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

async function waitForDashboard(
  store: JsonControlPlaneStore,
  predicate: (dashboard: Awaited<ReturnType<JsonControlPlaneStore["dashboard"]>>) => boolean
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dashboard = await store.dashboard();

    if (predicate(dashboard)) {
      return dashboard;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return store.dashboard();
}

class FakeWorkerAdapter implements WorkerAdapter {
  readonly kind = "codex";
  readonly startInputs: Array<{ goalTitle: string; prompt: string; cwd: string }> = [];

  constructor(
    private readonly events?: string[],
    private readonly eventName = "worker-start"
  ) {}

  async start(input: { goalTitle: string; prompt: string; cwd: string }) {
    this.events?.push(this.eventName);
    this.startInputs.push(input);

    return {
      command: "codexyoloproxy",
      cwd: input.cwd,
      resumeId: `resume-${input.goalTitle.toLowerCase().replaceAll(" ", "-")}`,
      pid: 4242,
      status: "running" as const,
      initialOutput: `started with ${input.prompt}`
    };
  }
}

class FakeRemoteWorkspaceProvisioner implements RemoteWorkspaceProvisioner {
  readonly inputs: Parameters<RemoteWorkspaceProvisioner["provision"]>[0][] = [];

  constructor(
    private readonly result: RemoteWorkspaceProvisionResult,
    private readonly events?: string[]
  ) {}

  async provision(input: Parameters<RemoteWorkspaceProvisioner["provision"]>[0]): Promise<RemoteWorkspaceProvisionResult> {
    this.events?.push("provision");
    this.inputs.push(input);
    return this.result;
  }
}

describe("StewardRuntime", () => {
  it("provisions the remote workspace before starting a remote Worker and audits success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const events: string[] = [];
    const localAdapter = new FakeWorkerAdapter();
    const remoteAdapter = new FakeWorkerAdapter(events, "remote-start");
    const provisioner = new FakeRemoteWorkspaceProvisioner({
      status: "prepared",
      summary: "Remote workspace prepared from git origin.",
      actions: ["Ensured remote cwd exists", "Fetched git origin"]
    }, events);

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const remoteNode = await store.upsertExecutionNode({
        name: "linux-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@linux-builder.internal",
        workRoot: "/srv/agent-fleet",
        proxyUrl: null,
        tags: ["remote", "linux", "high-cpu"]
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: () => remoteAdapter,
        remoteWorkspaceProvisioner: provisioner
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Run high CPU build",
        body: "Run high CPU tests on remote capacity."
      });

      const dashboard = await store.dashboard();

      expect(provisioner.inputs).toHaveLength(1);
      expect(events).toEqual(["provision", "remote-start"]);
      expect(provisioner.inputs[0]).toMatchObject({
        node: remoteNode,
        localWorkspacePath: "/projects/agent-fleet",
        remoteWorkspacePath: "/srv/agent-fleet/agent-fleet/agent-fleet"
      });
      expect(remoteAdapter.startInputs).toHaveLength(1);
      expect(remoteAdapter.startInputs[0].cwd).toBe("/srv/agent-fleet/agent-fleet/agent-fleet");
      expect(dashboard.decisions[0].actionsJson).toContain("Provision remote scratch workspace before Worker launch");
      expect(dashboard.stewardCheckpoints[0].nextAction).toContain("Remote workspace prepared from git origin.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks remote dispatch when workspace provisioning fails before Worker start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const localAdapter = new FakeWorkerAdapter();
    const remoteAdapter = new FakeWorkerAdapter();
    const provisioner = new FakeRemoteWorkspaceProvisioner({
      status: "blocked",
      summary: "Remote workspace blocked: local workspace has no git origin.",
      actions: ["Ensured remote cwd exists", "No git origin available"]
    });

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const remoteNode = await store.upsertExecutionNode({
        name: "linux-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@linux-builder.internal",
        workRoot: "/srv/agent-fleet",
        proxyUrl: null,
        tags: ["remote", "linux", "high-cpu"]
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: () => remoteAdapter,
        remoteWorkspaceProvisioner: provisioner
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Run high CPU build",
        body: "Run high CPU tests on remote capacity."
      });

      const dashboard = await store.dashboard();

      expect(goal.status).toBe("blocked");
      expect(provisioner.inputs).toHaveLength(1);
      expect(localAdapter.startInputs).toHaveLength(0);
      expect(remoteAdapter.startInputs).toHaveLength(0);
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: remoteNode.id,
        command: "remote workspace provisioning",
        cwd: "/srv/agent-fleet/agent-fleet/agent-fleet",
        status: "failed",
        lastOutput: "Remote workspace blocked: local workspace has no git origin."
      });
      expect(dashboard.stewardCheckpoints[0]).toMatchObject({
        reason: "dispatch",
        summary: "Remote workspace provisioning blocked Worker launch for goal: Run high CPU build"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not provision a remote workspace for local dispatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const localAdapter = new FakeWorkerAdapter();
    const provisioner = new FakeRemoteWorkspaceProvisioner({
      status: "prepared",
      summary: "Should not be used.",
      actions: []
    });

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkspaceProvisioner: provisioner
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Fix copy typo",
        body: "Update one sentence in the docs."
      });

      expect(provisioner.inputs).toHaveLength(0);
      expect(localAdapter.startInputs).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dispatches high CPU and long-running goals to a ready remote execution node", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const localAdapter = new FakeWorkerAdapter();
    const remoteAdapter = new FakeWorkerAdapter();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const remoteNode = await store.upsertExecutionNode({
        name: "linux-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@linux-builder.internal",
        workRoot: "/srv/agent-fleet",
        proxyUrl: "http://127.0.0.1:1080",
        tags: ["remote", "linux", "high-cpu"]
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: () => remoteAdapter
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Run long-running build",
        body: "Run high CPU tests overnight so the Mac stays responsive."
      });

      const dashboard = await store.dashboard();

      expect(localAdapter.startInputs).toHaveLength(0);
      expect(remoteAdapter.startInputs).toHaveLength(1);
      expect(remoteAdapter.startInputs[0].cwd).toBe("/srv/agent-fleet/agent-fleet/agent-fleet");
      expect(remoteAdapter.startInputs[0].prompt).toMatch(
        /^Worker Name: agent-fleet-run-long-running-build-remote-\d{12}\n/
      );
      expect(remoteAdapter.startInputs[0].prompt).toContain(
        "Use the exact Worker Name as the heading of your final report."
      );
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: remoteNode.id,
        cwd: "/srv/agent-fleet/agent-fleet/agent-fleet"
      });
      expect(dashboard.decisions[0].actionsJson).toContain("agent-fleet-run-long-running-build-remote-");
      expect(dashboard.stewardCheckpoints[0].summary).toContain(
        "agent-fleet-run-long-running-build-remote-"
      );
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        repositoryPath: "/projects/agent-fleet",
        worktreePath: "/srv/agent-fleet/agent-fleet/agent-fleet"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps ordinary small goals local even when remote capacity exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const localAdapter = new FakeWorkerAdapter();
    const remoteAdapter = new FakeWorkerAdapter();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      await store.upsertExecutionNode({
        name: "linux-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@linux-builder.internal",
        workRoot: "/srv/agent-fleet",
        proxyUrl: "http://127.0.0.1:1080",
        tags: ["remote", "linux", "high-cpu"],
        capacity: 2
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: () => remoteAdapter
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Fix copy typo",
        body: "Update one sentence in the docs."
      });

      const dashboard = await store.dashboard();

      expect(remoteAdapter.startInputs).toHaveLength(0);
      expect(localAdapter.startInputs).toHaveLength(1);
      expect(localAdapter.startInputs[0].prompt).toMatch(/^Worker Name: agent-fleet-fix-copy-typo-\d{12}\n/);
      expect(localAdapter.startInputs[0].prompt).not.toContain("-remote-");
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: null,
        cwd: "/projects/agent-fleet"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("selects a GPU-tagged ready remote node for GPU goals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const localAdapter = new FakeWorkerAdapter();
    const cpuAdapter = new FakeWorkerAdapter();
    const gpuAdapter = new FakeWorkerAdapter();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      await store.upsertExecutionNode({
        name: "linux-cpu",
        kind: "remote",
        status: "ready",
        sshHost: "worker@linux-cpu.internal",
        workRoot: "/srv/cpu",
        proxyUrl: null,
        tags: ["remote", "linux", "high-cpu"],
        capacity: 2
      });
      const gpuNode = await store.upsertExecutionNode({
        name: "linux-gpu",
        kind: "remote",
        status: "ready",
        sshHost: "worker@linux-gpu.internal",
        workRoot: "/srv/gpu",
        proxyUrl: null,
        tags: ["remote", "linux", "gpu", "cuda"],
        capacity: 1
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: (node) => (node.id === gpuNode.id ? gpuAdapter : cpuAdapter)
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Run CUDA model inference",
        body: "Use GPU for 模型 推理."
      });

      const dashboard = await store.dashboard();

      expect(localAdapter.startInputs).toHaveLength(0);
      expect(cpuAdapter.startInputs).toHaveLength(0);
      expect(gpuAdapter.startInputs).toHaveLength(1);
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: gpuNode.id,
        cwd: "/srv/gpu/agent-fleet/agent-fleet"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips ready remote nodes at capacity and falls back to the next available remote", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const firstAdapter = new FakeWorkerAdapter();
    const secondAdapter = new FakeWorkerAdapter();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const goal = await store.createGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Existing remote work",
        body: "Already running."
      });
      const decision = await store.recordDecision({
        goalId: goal.id,
        workerSessionId: null,
        title: "Existing Worker",
        rationale: "Existing load consumes capacity.",
        risk: "low",
        confidence: 1,
        reversible: true,
        needsHumanReview: false,
        status: "active",
        actions: []
      });
      const busyNode = await store.upsertExecutionNode({
        name: "busy-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@busy.internal",
        workRoot: "/srv/busy",
        proxyUrl: null,
        tags: ["remote", "linux", "high-cpu"],
        capacity: 1
      });
      const availableNode = await store.upsertExecutionNode({
        name: "available-builder",
        kind: "remote",
        status: "ready",
        sshHost: "worker@available.internal",
        workRoot: "/srv/available",
        proxyUrl: null,
        tags: ["remote", "linux", "high-cpu"],
        capacity: 1
      });
      await store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/srv/busy/agent-fleet/agent-fleet",
        pid: 1111,
        hostId: busyNode.id,
        resumeId: "resume-busy",
        status: "running"
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: new FakeWorkerAdapter(),
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: (node) => (node.id === busyNode.id ? firstAdapter : secondAdapter)
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Run heavy build and test",
        body: "High-load parallel test work should avoid saturated nodes."
      });

      const dashboard = await store.dashboard();
      const newSession = dashboard.workerSessions.at(-1);

      expect(firstAdapter.startInputs).toHaveLength(0);
      expect(secondAdapter.startInputs).toHaveLength(1);
      expect(newSession).toMatchObject({
        hostId: availableNode.id,
        cwd: "/srv/available/agent-fleet/agent-fleet"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the local Worker adapter when no remote execution node is ready", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const localAdapter = new FakeWorkerAdapter();
    const remoteAdapter = new FakeWorkerAdapter();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      await store.upsertExecutionNode({
        name: "linux-builder",
        kind: "remote",
        status: "unknown",
        sshHost: "worker@linux-builder.internal",
        workRoot: "/srv/agent-fleet",
        proxyUrl: "http://127.0.0.1:1080"
      });
      const runtime = new StewardRuntime({
        store,
        workerAdapter: localAdapter,
        defaultWorkerCwd: "/worktrees/agent-fleet",
        remoteWorkerAdapterFactory: () => remoteAdapter
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Use local fallback",
        body: "Run high CPU build work locally if remote is not ready."
      });

      const dashboard = await store.dashboard();

      expect(remoteAdapter.startInputs).toHaveLength(0);
      expect(localAdapter.startInputs).toHaveLength(1);
      expect(localAdapter.startInputs[0].cwd).toBe("/projects/agent-fleet");
      expect(dashboard.decisions[0].actionsJson).toContain("Use local Worker fallback; no ready remote capacity is available.");
      expect(dashboard.workerSessions[0]).toMatchObject({
        hostId: null,
        cwd: "/projects/agent-fleet"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("turns a human goal into an auditable decision and Worker session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: new FakeWorkerAdapter(),
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });

      const dashboard = await store.dashboard();

      expect(goal.status).toBe("running");
      expect(dashboard.decisions).toHaveLength(1);
      expect(dashboard.decisions[0]).toMatchObject({
        goalId: goal.id,
        title: "Start Worker Agent for goal",
        risk: "medium",
        needsHumanReview: true,
        status: "active"
      });
      expect(dashboard.workerSessions[0]).toMatchObject({
        goalId: goal.id,
        decisionId: dashboard.decisions[0].id,
        kind: "codex",
        command: "codexyoloproxy",
        cwd: "/projects/agent-fleet",
        resumeId: "resume-bootstrap-agent-fleet",
        status: "running"
      });
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        workerSessionId: dashboard.workerSessions[0].id,
        repositoryPath: "/projects/agent-fleet",
        worktreePath: `/projects/agent-fleet/.worktrees/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        branchName: `agent-fleet/${dashboard.workerSessions[0].id}-bootstrap-agent-fleet`,
        status: "planned"
      });
      expect(dashboard.stewardCheckpoints[0]).toMatchObject({
        reason: "dispatch",
        goalIds: [goal.id],
        workerSessionIds: [dashboard.workerSessions[0].id]
      });
      expect(dashboard.stewardCheckpoints[0].nextAction).toContain(
        `Monitor Worker session ${dashboard.workerSessions[0].id}; resume with codexyoloproxy resume resume-bootstrap-agent-fleet if the Steward session is interrupted. Worker Name: agent-fleet-bootstrap-agent-fleet-`
      );
      expect(dashboard.events.map((event) => event.type)).toEqual([
        "goal.created",
        "decision.recorded",
        "worker.started",
        "worktree.planned",
        "goal.updated",
        "steward.checkpoint.recorded"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records human correction and creates a follow-up Steward decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: new FakeWorkerAdapter(),
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });
      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });
      const decision = (await store.dashboard()).decisions[0];

      const correction = await runtime.correctDecision({
        decisionId: decision.id,
        body: "Do not use Butler terminology. Use Steward Agent and Worker Agent."
      });

      const dashboard = await store.dashboard();

      expect(correction.body).toContain("Steward Agent");
      expect(dashboard.memories).toContainEqual(
        expect.objectContaining({
          scope: "user",
          key: "correction:terminology",
          value: "Do not use Butler terminology. Use Steward Agent and Worker Agent."
        })
      );
      expect(dashboard.decisions.map((item) => item.title)).toContain("Apply human correction");
      expect(dashboard.events.map((event) => event.type)).toContain("correction.recorded");
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject({
        reason: "correction",
        summary: "Human correction recorded for Steward decision.",
        nextAction: "Use the correction in future Worker instructions and recovery summaries."
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks the goal when the Worker command cannot start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start() {
            return {
              command: "missing-worker",
              cwd: "/worktrees/agent-fleet",
              resumeId: null,
              status: "failed" as const,
              pid: null,
              initialOutput: "Worker command not found: missing-worker"
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });
      const dashboard = await store.dashboard();

      expect(goal.status).toBe("blocked");
      expect(dashboard.workerSessions[0]).toMatchObject({
        command: "missing-worker",
        status: "failed",
        resumeId: null
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("completes the goal when the Worker process exits successfully", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start() {
            return {
              command: "codexyoloproxy",
              cwd: "/worktrees/agent-fleet",
              resumeId: "resume-completed",
              pid: 4343,
              status: "completed" as const,
              initialOutput: "Worker completed"
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });

      expect(goal.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records background Worker completion and completes the goal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const completion = deferred<{ status: "completed"; output: string }>();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start(input) {
            return {
              command: "codexyoloproxy",
              cwd: input.cwd,
              resumeId: "resume-background-completed",
              pid: 4545,
              status: "running" as const,
              initialOutput: "Worker accepted prompt",
              completion: completion.promise
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Finish in background",
        body: "Update status when the Worker exits."
      });

      expect(goal.status).toBe("running");

      completion.resolve({
        status: "completed",
        output: "Worker accepted prompt\nFinal report\nnpm run check passed"
      });

      const dashboard = await waitForDashboard(
        store,
        (state) =>
          state.goals[0].status === "completed" &&
          state.workerSessions[0].status === "completed" &&
          state.stewardCheckpoints.at(-1)?.reason === "recovery"
      );

      expect(dashboard.goals[0]).toMatchObject({ id: goal.id, status: "completed" });
      expect(dashboard.workerSessions[0]).toMatchObject({
        status: "completed",
        lastOutput: "Worker accepted prompt\nFinal report\nnpm run check passed"
      });
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject({
        reason: "recovery",
        summary: `Worker session ${dashboard.workerSessions[0].id} completed for goal: Finish in background`,
        goalIds: [goal.id],
        workerSessionIds: [dashboard.workerSessions[0].id]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ingests a structured Worker final report from background completion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const completion = deferred<{ status: "completed"; output: string }>();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start(input) {
            return {
              command: "codexyoloproxy",
              cwd: input.cwd,
              resumeId: "resume-background-report",
              pid: 4747,
              status: "running" as const,
              initialOutput: "Worker accepted prompt",
              completion: completion.promise
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Ingest Worker report",
        body: "Parse final Worker output into durable report state."
      });

      completion.resolve({
        status: "completed",
        output: [
          "raw debug line that should remain in lastOutput only",
          "# agent-fleet-ingest-worker-report-202604262151",
          "",
          "Status: DONE_WITH_CONCERNS",
          "Changed files:",
          "- src/server/workers/workerReportParser.ts",
          "Verification:",
          "- npm run check passed",
          "Decisions:",
          "- Store parsed reports separately from raw stdout.",
          "Blockers:",
          "- Human should double-check merge risk.",
          "Next actions:",
          "- Review the Worker report before delivery.",
          "Needs owner review: yes",
          "Resume id: resume-from-final-report"
        ].join("\n")
      });

      const dashboard = await waitForDashboard(
        store,
        (state) =>
          (state.workerReports ?? []).length === 1 &&
          state.workerSessions[0].status === "completed" &&
          state.stewardCheckpoints.at(-1)?.nextAction.includes("Review the Worker report before delivery.") === true
      );
      const workerReports = dashboard.workerReports ?? [];

      expect(dashboard.workerSessions[0]).toMatchObject({
        status: "completed",
        lastOutput: expect.stringContaining("raw debug line")
      });
      expect(workerReports[0]).toMatchObject({
        goalId: goal.id,
        workerSessionId: dashboard.workerSessions[0].id,
        status: "DONE_WITH_CONCERNS",
        changedFiles: ["src/server/workers/workerReportParser.ts"],
        verification: ["npm run check passed"],
        decisions: ["Store parsed reports separately from raw stdout."],
        blockers: ["Human should double-check merge risk."],
        nextActions: ["Review the Worker report before delivery."],
        needsOwnerReview: true,
        resumeId: "resume-from-final-report"
      });
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject({
        reason: "recovery",
        nextAction: expect.stringContaining("DONE_WITH_CONCERNS")
      });
      expect(dashboard.stewardCheckpoints.at(-1)?.nextAction).toContain("Owner review required.");
      expect(dashboard.stewardCheckpoints.at(-1)?.nextAction).not.toContain("raw debug line");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records background Worker failure and blocks the goal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const completion = deferred<{ status: "failed"; output: string }>();

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter: {
          kind: "codex",
          async start(input) {
            return {
              command: "codexyoloproxy",
              cwd: input.cwd,
              resumeId: "resume-background-failed",
              pid: 4646,
              status: "running" as const,
              initialOutput: "Worker accepted prompt",
              completion: completion.promise
            };
          }
        },
        defaultWorkerCwd: "/worktrees/agent-fleet"
      });

      const goal = await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Fail in background",
        body: "Update status when the Worker exits."
      });

      completion.resolve({
        status: "failed",
        output: "Worker accepted prompt\nTests failed"
      });

      const dashboard = await waitForDashboard(
        store,
        (state) =>
          state.goals[0].status === "blocked" &&
          state.workerSessions[0].status === "failed" &&
          state.stewardCheckpoints.at(-1)?.reason === "recovery"
      );

      expect(dashboard.goals[0]).toMatchObject({ id: goal.id, status: "blocked" });
      expect(dashboard.workerSessions[0]).toMatchObject({
        status: "failed",
        lastOutput: "Worker accepted prompt\nTests failed"
      });
      expect(dashboard.stewardCheckpoints.at(-1)).toMatchObject({
        reason: "recovery",
        summary: `Worker session ${dashboard.workerSessions[0].id} failed for goal: Fail in background`,
        goalIds: [goal.id],
        workerSessionIds: [dashboard.workerSessions[0].id]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("materializes a worktree before starting the Worker when a runner is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-steward-"));
    const events: string[] = [];
    const workerAdapter = new FakeWorkerAdapter();
    const runner: MaterializeWorktreeRunner = {
      pathExists: async () => {
        events.push("pathExists");
        return false;
      },
      ensureDir: async () => {
        events.push("ensureDir");
      },
      run: async () => {
        events.push("run");
        return {
          exitCode: 0,
          stdout: "created",
          stderr: ""
        };
      }
    };

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const runtime = new StewardRuntime({
        store,
        workerAdapter,
        defaultWorkerCwd: "/repo/agent-fleet",
        defaultRepositoryPath: "/repo/agent-fleet",
        worktreeRoot: "/repo/agent-fleet/.worktrees",
        worktreeRunner: runner
      });

      await runtime.acceptGoal({
        projectName: "agent-fleet",
        workspacePath: "/projects/agent-fleet",
        title: "Bootstrap agent-fleet",
        body: "Build the first Steward/Worker loop."
      });

      const dashboard = await store.dashboard();
      events.push("assert");

      expect(workerAdapter.startInputs[0].cwd).toBe(dashboard.worktreeAssignments[0].worktreePath);
      expect(dashboard.workerSessions[0].cwd).toBe(dashboard.worktreeAssignments[0].worktreePath);
      expect(dashboard.worktreeAssignments[0]).toMatchObject({
        repositoryPath: "/projects/agent-fleet",
        status: "planned"
      });
      expect(dashboard.worktreeAssignments[0].branchName).toContain("agent-fleet/");
      expect(dashboard.worktreeAssignments[0].worktreePath).toContain("bootstrap-agent-fleet");
      expect(events.slice(0, 3)).toEqual(["pathExists", "ensureDir", "run"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
