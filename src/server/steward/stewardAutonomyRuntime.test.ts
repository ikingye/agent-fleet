import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { runStewardAutonomyTick } from "./stewardAutonomyRuntime.js";

async function withStore<T>(testBody: (store: JsonControlPlaneStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "agent-fleet-autonomy-"));

  try {
    return await testBody(await JsonControlPlaneStore.open(join(dir, "state.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function createSession(
  store: JsonControlPlaneStore,
  input: {
    goalStatus?: "queued" | "running" | "blocked" | "completed";
    sessionStatus?: "starting" | "running" | "paused" | "completed" | "failed";
    lastOutput?: string;
  } = {}
) {
  const goal = await store.createGoal({
    projectName: "agent-fleet",
    workspacePath: "/projects/agent-fleet",
    title: "Autonomy loop",
    body: "Continue Steward work from durable control-plane state."
  });
  const decision = await store.recordDecision({
    goalId: goal.id,
    workerSessionId: null,
    title: "Start Worker Agent for goal",
    rationale: "Initial dispatch decision.",
    risk: "medium",
    confidence: 0.72,
    reversible: true,
    needsHumanReview: true,
    status: "active",
    actions: ["Start a Worker Agent session"]
  });
  const session = await store.createWorkerSession({
    goalId: goal.id,
    decisionId: decision.id,
    kind: "codex",
    command: "codexyoloproxy",
    cwd: "/projects/agent-fleet",
    pid: 4242,
    hostId: null,
    resumeId: "resume-autonomy",
    status: input.sessionStatus ?? "running",
    lastOutput: input.lastOutput ?? "Worker started"
  });
  await store.linkDecisionToWorkerSession(decision.id, session.id);
  await store.updateGoalStatus(goal.id, input.goalStatus ?? "running");

  return { goal, decision, session };
}

describe("runStewardAutonomyTick", () => {
  it("does not queue duplicate Worker work while an active session exists", async () => {
    await withStore(async (store) => {
      await createSession(store);

      const tick = await runStewardAutonomyTick({
        store,
        async probeProcess() {
          return { status: "running" };
        }
      });
      const dashboard = await store.dashboard();

      expect(tick.result).toMatchObject({
        checked: 1,
        updated: 0,
        decisionsRecorded: 0,
        handoffsQueued: 0,
        ownerReviewNeeded: 0
      });
      expect(dashboard.workerSessions).toHaveLength(1);
      expect(dashboard.decisions.map((decision) => decision.title)).toEqual(["Start Worker Agent for goal"]);
      expect(tick.checkpoint.nextAction).toContain("Inspect Worker session");
    });
  });

  it("queues a review and merge handoff for a completed Worker report", async () => {
    await withStore(async (store) => {
      const { goal, session } = await createSession(store, {
        goalStatus: "completed",
        sessionStatus: "completed",
        lastOutput: "Status: DONE"
      });
      const report = await store.recordWorkerReport({
        goalId: goal.id,
        workerSessionId: session.id,
        status: "DONE",
        changedFiles: ["src/server/steward/stewardAutonomyRuntime.ts"],
        verification: ["npm test -- src/server/steward/stewardAutonomyRuntime.test.ts"],
        decisions: ["Keep the autonomy tick deterministic."],
        blockers: [],
        nextActions: ["Review and merge the Worker branch."],
        needsOwnerReview: false,
        resumeId: "resume-autonomy",
        markdown: "Status: DONE"
      });

      const tick = await runStewardAutonomyTick({
        store,
        async probeProcess() {
          throw new Error("No active sessions should be probed");
        }
      });
      const dashboard = await store.dashboard();
      const handoffDecision = dashboard.decisions.at(-1);

      expect(tick.result).toMatchObject({
        checked: 0,
        updated: 0,
        decisionsRecorded: 1,
        handoffsQueued: 1,
        ownerReviewNeeded: 0
      });
      expect(handoffDecision).toMatchObject({
        goalId: goal.id,
        workerSessionId: session.id,
        title: "Queue review and merge handoff",
        needsHumanReview: false
      });
      expect(JSON.parse(handoffDecision?.actionsJson ?? "[]")).toContain(`Worker report: ${report.id}`);
      expect(tick.checkpoint.nextAction).toContain("Review and merge the Worker branch.");
    });
  });

  it("requests owner and Steward review for failed Worker sessions", async () => {
    await withStore(async (store) => {
      const { goal, session } = await createSession(store, {
        goalStatus: "blocked",
        sessionStatus: "failed",
        lastOutput: "Tests failed after implementation"
      });

      const tick = await runStewardAutonomyTick({
        store,
        async probeProcess() {
          throw new Error("No active sessions should be probed");
        }
      });
      const dashboard = await store.dashboard();
      const reviewDecision = dashboard.decisions.at(-1);

      expect(tick.result).toMatchObject({
        checked: 0,
        updated: 0,
        decisionsRecorded: 1,
        handoffsQueued: 0,
        ownerReviewNeeded: 1
      });
      expect(reviewDecision).toMatchObject({
        goalId: goal.id,
        workerSessionId: session.id,
        title: "Request owner review for failed Worker session",
        risk: "high",
        needsHumanReview: true
      });
      expect(tick.checkpoint.nextAction).toContain("Review failed Worker session");
      expect(tick.checkpoint.nextAction).toContain("Tests failed after implementation");
    });
  });

  it("includes recovery and memory context in the checkpoint next action", async () => {
    await withStore(async (store) => {
      await store.upsertMemory({
        scope: "user",
        projectName: null,
        key: "preference:decision-review:high-impact",
        value: "Escalate irreversible merge decisions to me.",
        sourceCorrectionId: null
      });
      const { goal, session } = await createSession(store, {
        goalStatus: "completed",
        sessionStatus: "completed",
        lastOutput: "Status: DONE_WITH_CONCERNS"
      });
      await store.recordWorkerReport({
        goalId: goal.id,
        workerSessionId: session.id,
        status: "DONE_WITH_CONCERNS",
        changedFiles: ["src/server/steward/stewardAutonomyRuntime.ts"],
        verification: ["npm run check"],
        decisions: ["Queue owner-visible review before merging."],
        blockers: ["Merge needs a human double-check."],
        nextActions: ["Ask the owner to review the merge handoff."],
        needsOwnerReview: true,
        resumeId: null,
        markdown: "Status: DONE_WITH_CONCERNS"
      });

      const tick = await runStewardAutonomyTick({
        store,
        async probeProcess() {
          throw new Error("No active sessions should be probed");
        }
      });

      expect(tick.result.ownerReviewNeeded).toBe(1);
      expect(tick.checkpoint.nextAction).toContain("Ask the owner to review the merge handoff.");
      expect(tick.checkpoint.nextAction).toContain("Memory applied: Applied 1 relevant owner memory.");
    });
  });
});
