import type { AgentArtifact, DeliveryReport, ExecutionNode, Goal, ReviewResult } from "../../shared/types.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";

export interface RunGoalDeliveryInput {
  store: JsonControlPlaneStore;
  goalId: string;
  maxWorkers?: number;
}

const defaultWorkerTasks = [
  "Define the smallest useful deliverable for the goal.",
  "Implement or specify the core behavior needed by the deliverable.",
  "Verify the deliverable against acceptance criteria."
];

export async function runGoalDelivery(input: RunGoalDeliveryInput): Promise<DeliveryReport> {
  const dashboard = await input.store.dashboard();
  const goal = findGoal(dashboard.goals, input.goalId);
  const resource = selectExecutionResource(dashboard.executionNodes);
  const resourceId = resource?.id ?? null;
  const workerTasks = buildWorkerTasks(input.maxWorkers ?? 3);

  const research = await input.store.recordAgentArtifact({
    goalId: goal.id,
    role: "researcher",
    kind: "research",
    title: "Research notes",
    path: `artifacts/${goal.id}/research_notes.md`,
    content: buildResearchNotes(goal),
    resourceId
  });
  const plan = await input.store.recordAgentArtifact({
    goalId: goal.id,
    role: "planner",
    kind: "plan",
    title: "Project plan",
    path: `artifacts/${goal.id}/project_plan.md`,
    content: buildProjectPlan(goal, research, workerTasks),
    resourceId
  });
  const workerArtifacts: AgentArtifact[] = [];

  for (const [index, task] of workerTasks.entries()) {
    workerArtifacts.push(
      await input.store.recordAgentArtifact({
        goalId: goal.id,
        role: "worker",
        kind: "worker_output",
        title: `Worker output ${index + 1}`,
        path: `artifacts/${goal.id}/worker_${index + 1}.md`,
        content: buildWorkerOutput(goal, task, plan),
        resourceId
      })
    );
  }

  const reviewedArtifactIds = [research.id, plan.id, ...workerArtifacts.map((artifact) => artifact.id)];
  const reviewerArtifacts: AgentArtifact[] = [];
  const reviews: ReviewResult[] = [];

  for (const reviewer of ["scope-reviewer", "quality-reviewer"]) {
    const review = await input.store.recordReviewResult({
      goalId: goal.id,
      reviewer,
      status: "passed",
      summary: `${reviewer} accepted ${reviewedArtifactIds.length} artifacts for delivery.`,
      artifactIds: reviewedArtifactIds,
      resourceId
    });

    reviews.push(review);
    reviewerArtifacts.push(
      await input.store.recordAgentArtifact({
        goalId: goal.id,
        role: "reviewer",
        kind: "review",
        title: `${reviewer} report`,
        path: `artifacts/${goal.id}/${reviewer}.md`,
        content: buildReviewArtifact(goal, review),
        resourceId
      })
    );
  }

  const preDeliveryArtifacts = [research, plan, ...workerArtifacts, ...reviewerArtifacts];
  const markdown = buildDeliveryMarkdown({
    goal,
    resource,
    artifacts: preDeliveryArtifacts,
    reviews,
    workerTasks
  });
  const deliveryArtifact = await input.store.recordAgentArtifact({
    goalId: goal.id,
    role: "deliverer",
    kind: "delivery",
    title: "Final delivery report",
    path: `artifacts/${goal.id}/final_report.md`,
    content: markdown,
    resourceId
  });
  const report = await input.store.recordDeliveryReport({
    goalId: goal.id,
    status: "delivered",
    markdown,
    artifactIds: [...preDeliveryArtifacts.map((artifact) => artifact.id), deliveryArtifact.id],
    reviewResultIds: reviews.map((review) => review.id),
    resourceId
  });

  await input.store.updateGoalStatus(goal.id, "completed");

  return report;
}

function findGoal(goals: Goal[], goalId: string): Goal {
  const goal = goals.find((item) => item.id === goalId);

  if (goal === undefined) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  return goal;
}

function selectExecutionResource(resources: ExecutionNode[]): ExecutionNode | null {
  const ready = resources.filter((resource) => resource.status === "ready");
  const remote = ready.find((resource) => resource.kind === "remote");

  return remote ?? ready.find((resource) => resource.kind === "local") ?? null;
}

function buildWorkerTasks(maxWorkers: number): string[] {
  const workerCount = Math.max(1, Math.min(6, Math.floor(maxWorkers)));

  return Array.from({ length: workerCount }, (_, index) => defaultWorkerTasks[index] ?? `Complete delivery task ${index + 1}.`);
}

function buildResearchNotes(goal: Goal): string {
  return [
    "# Research Notes",
    "",
    `Goal: ${goal.title}`,
    "",
    "## Understanding",
    goal.body,
    "",
    "## Key Unknowns",
    "- Exact production environment and external credentials are not assumed.",
    "- Any remote server must be registered before real remote execution.",
    "",
    "## Risks",
    "- Over-scoping the first delivery pass.",
    "- Treating simulated output as production verification."
  ].join("\n");
}

function buildProjectPlan(goal: Goal, research: AgentArtifact, tasks: string[]): string {
  return [
    "# Project Plan",
    "",
    `Goal: ${goal.title}`,
    `Research artifact: ${research.path}`,
    "",
    "## Worker Tasks",
    ...tasks.map((task, index) => `${index + 1}. ${task}`),
    "",
    "## Acceptance Criteria",
    "- Artifacts exist for research, planning, work, review, and delivery.",
    "- Review results are recorded before final delivery.",
    "- Final report lists known limitations and next steps."
  ].join("\n");
}

function buildWorkerOutput(goal: Goal, task: string, plan: AgentArtifact): string {
  return [
    "# Worker Output",
    "",
    `Goal: ${goal.title}`,
    `Task: ${task}`,
    `Plan artifact: ${plan.path}`,
    "",
    "## Result",
    `Completed deterministic MVP work for: ${task}`,
    "",
    "## Evidence",
    "- Output is stored as an agent-fleet artifact.",
    "- Reviewers will evaluate this artifact before delivery."
  ].join("\n");
}

function buildReviewArtifact(goal: Goal, review: ReviewResult): string {
  return [
    "# Review Report",
    "",
    `Goal: ${goal.title}`,
    `Reviewer: ${review.reviewer}`,
    `Status: ${review.status}`,
    "",
    review.summary
  ].join("\n");
}

function buildDeliveryMarkdown(input: {
  goal: Goal;
  resource: ExecutionNode | null;
  artifacts: AgentArtifact[];
  reviews: ReviewResult[];
  workerTasks: string[];
}): string {
  const resourceLabel =
    input.resource === null
      ? "No ready execution node was registered; Steward used deterministic local orchestration."
      : `${input.resource.name} (${input.resource.kind})`;

  return [
    `# Delivery Report: ${input.goal.title}`,
    "",
    "## Goal",
    input.goal.body,
    "",
    "## Selected Resources",
    `- ${resourceLabel}`,
    "",
    "## Assignment Summary",
    ...input.workerTasks.map((task, index) => `- Worker ${index + 1}: ${task}`),
    "",
    "## Artifacts",
    ...input.artifacts.map((artifact) => `- ${artifact.role}: ${artifact.title} (${artifact.path})`),
    "",
    "## Review Summary",
    ...input.reviews.map((review) => `- ${review.reviewer}: ${review.status} - ${review.summary}`),
    "",
    "## Final Deliverables",
    "- Durable research, plan, worker, review, and delivery records in agent-fleet state.",
    "- Final Markdown report stored with the delivery report.",
    "",
    "## Known Limitations",
    "- MVP delivery artifacts are deterministic Steward-generated outputs.",
    "- Real Worker Agent execution and automatic retry loops remain separate runtime work.",
    "",
    "## Next Steps",
    "- Wire this delivery flow to real Worker Agent sessions.",
    "- Let reviewers trigger targeted follow-up Worker assignments when a review fails."
  ].join("\n");
}
