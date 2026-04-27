import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import { runGoalDelivery } from "./deliveryRuntime.js";

describe("runGoalDelivery", () => {
  it("turns a goal and resource pool into a delivered artifact chain using remote resources first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-delivery-"));

    try {
      const store = await JsonControlPlaneStore.open(join(dir, "state.json"));
      const remote = await store.upsertExecutionNode({
        name: "remote-dev-1",
        kind: "remote",
        status: "ready",
        sshHost: "worker@remote-dev-1.example",
        workRoot: "/srv/agent-fleet/workspaces",
        proxyUrl: "http://127.0.0.1:1080"
      });
      await store.upsertExecutionNode({
        name: "local-codex",
        kind: "local",
        status: "ready",
        sshHost: null,
        workRoot: "./.agent-fleet/workspaces/local",
        proxyUrl: null
      });
      const goal = await store.createGoal({
        projectName: "agent-fleet",
        title: "Build a tiny demo project",
        body: "Create a small demo, test it, review it, and deliver a report."
      });

      const report = await runGoalDelivery({
        store,
        goalId: goal.id,
        maxWorkers: 2
      });
      const dashboard = await store.dashboard();

      expect(report).toMatchObject({
        goalId: goal.id,
        status: "delivered"
      });
      expect(report.markdown).toContain("# Delivery Report: Build a tiny demo project");
      expect(report.markdown).toContain("## Selected Resources");
      expect(report.markdown).toContain("remote-dev-1");
      expect(report.markdown).toContain("## Review Summary");
      expect(report.markdown).toContain("## Next Steps");

      expect(dashboard.agentArtifacts.map((artifact) => artifact.role)).toEqual([
        "researcher",
        "planner",
        "worker",
        "worker",
        "reviewer",
        "reviewer",
        "deliverer"
      ]);
      expect(dashboard.agentArtifacts.filter((artifact) => artifact.role === "worker")).toHaveLength(2);
      expect(dashboard.agentArtifacts.filter((artifact) => artifact.resourceId === remote.id)).toHaveLength(7);
      expect(dashboard.reviews).toHaveLength(2);
      expect(dashboard.reviews.map((review) => review.status)).toEqual(["passed", "passed"]);
      expect(dashboard.deliveryReports[0]).toMatchObject({
        id: report.id,
        goalId: goal.id,
        status: "delivered"
      });
      expect(dashboard.goals[0].status).toBe("completed");
      expect(dashboard.events.map((event) => event.type)).toContain("delivery.completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
