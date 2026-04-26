import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AgentArtifact,
  AgentRole,
  ArtifactKind,
  ControlPlaneEvent,
  DashboardData,
  DecisionCorrection,
  DecisionRisk,
  DecisionStatus,
  DeliveryReport,
  DeliveryStatus,
  ExecutionNode,
  Goal,
  GoalStatus,
  MemoryEntry,
  MemoryScope,
  ReviewResult,
  ReviewStatus,
  StewardCheckpoint,
  StewardCheckpointReason,
  StewardDecision,
  StewardMessage,
  StewardMessageRole,
  WorkerKind,
  WorktreeAssignment,
  WorkerSession,
  WorkerSessionStatus
} from "../../shared/types.js";

interface ControlPlaneState extends Omit<DashboardData, "stewardMessages"> {
  version: 1;
  stewardMessages: StewardMessage[];
}

export interface CreateGoalInput {
  projectName: string;
  workspacePath?: string;
  title: string;
  body: string;
}

export interface RecordDecisionInput {
  goalId: string;
  workerSessionId: string | null;
  title: string;
  rationale: string;
  risk: DecisionRisk;
  confidence: number;
  reversible: boolean;
  needsHumanReview: boolean;
  status: DecisionStatus;
  actions: string[];
}

export interface CreateWorkerSessionInput {
  goalId: string;
  decisionId: string;
  kind: WorkerKind;
  command: string;
  cwd: string;
  pid: number | null;
  hostId: string | null;
  resumeId: string | null;
  status: WorkerSessionStatus;
  lastOutput?: string;
}

export interface UpdateWorkerSessionStatusInput {
  workerSessionId: string;
  status: WorkerSessionStatus;
  lastOutput?: string;
}

export interface CreateWorktreeAssignmentInput {
  workerSessionId: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
}

export interface RecordStewardCheckpointInput {
  reason: StewardCheckpointReason;
  summary: string;
  nextAction: string;
  goalIds: string[];
  workerSessionIds: string[];
}

export interface AddCorrectionInput {
  decisionId: string;
  body: string;
  createdBy: "human" | "steward";
}

export interface UpsertMemoryInput {
  scope: MemoryScope;
  projectName: string | null;
  key: string;
  value: string;
  sourceCorrectionId: string | null;
}

export type UpsertExecutionNodeInput = Omit<ExecutionNode, "id" | "createdAt" | "updatedAt">;

export interface RecordAgentArtifactInput {
  goalId: string;
  role: AgentRole;
  kind: ArtifactKind;
  title: string;
  path: string;
  content: string;
  resourceId: string | null;
}

export interface RecordReviewResultInput {
  goalId: string;
  reviewer: string;
  status: ReviewStatus;
  summary: string;
  artifactIds: string[];
  resourceId: string | null;
}

export interface RecordDeliveryReportInput {
  goalId: string;
  status: DeliveryStatus;
  markdown: string;
  artifactIds: string[];
  reviewResultIds: string[];
  resourceId: string | null;
}

export interface RecordStewardMessageInput {
  role: StewardMessageRole;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
  body: string;
}

export interface ListStewardMessagesFilter {
  projectName?: string;
  workspacePath?: string;
}

function now(): string {
  return new Date().toISOString();
}

function emptyState(): ControlPlaneState {
  return {
    version: 1,
    goals: [],
    decisions: [],
    workerSessions: [],
    corrections: [],
    memories: [],
    executionNodes: [],
    worktreeAssignments: [],
    stewardCheckpoints: [],
    stewardMessages: [],
    agentArtifacts: [],
    reviews: [],
    deliveryReports: [],
    events: []
  };
}

function parseState(raw: string): ControlPlaneState {
  const parsed = JSON.parse(raw) as Partial<ControlPlaneState>;

  return {
    version: 1,
    goals: (parsed.goals ?? []).map(normalizeGoal),
    decisions: parsed.decisions ?? [],
    workerSessions: parsed.workerSessions ?? [],
    corrections: parsed.corrections ?? [],
    memories: parsed.memories ?? [],
    executionNodes: parsed.executionNodes ?? [],
    worktreeAssignments: parsed.worktreeAssignments ?? [],
    stewardCheckpoints: parsed.stewardCheckpoints ?? [],
    stewardMessages: parsed.stewardMessages ?? [],
    agentArtifacts: parsed.agentArtifacts ?? [],
    reviews: parsed.reviews ?? [],
    deliveryReports: parsed.deliveryReports ?? [],
    events: parsed.events ?? []
  };
}

function normalizeGoal(goal: Goal | (Omit<Goal, "workspacePath"> & { workspacePath?: string })): Goal {
  return {
    ...goal,
    workspacePath:
      typeof goal.workspacePath === "string" && goal.workspacePath.trim() !== ""
        ? goal.workspacePath
        : legacyWorkspacePath(goal.projectName)
  };
}

function legacyWorkspacePath(projectName: string): string {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, "-")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  return `/legacy-agent-fleet-workspaces/${slug === "" ? "untitled" : slug}`;
}

export class JsonControlPlaneStore {
  private constructor(
    private readonly statePath: string,
    private state: ControlPlaneState
  ) {}

  static async open(statePath: string): Promise<JsonControlPlaneStore> {
    await mkdir(dirname(statePath), { recursive: true });

    try {
      return new JsonControlPlaneStore(statePath, parseState(await readFile(statePath, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        const store = new JsonControlPlaneStore(statePath, emptyState());
        await store.save();
        return store;
      }

      throw error;
    }
  }

  async dashboard(): Promise<DashboardData> {
    return {
      goals: [...this.state.goals],
      decisions: [...this.state.decisions],
      workerSessions: [...this.state.workerSessions],
      corrections: [...this.state.corrections],
      memories: [...this.state.memories],
      executionNodes: [...this.state.executionNodes],
      worktreeAssignments: [...this.state.worktreeAssignments],
      stewardCheckpoints: [...this.state.stewardCheckpoints],
      stewardMessages: [...this.state.stewardMessages],
      agentArtifacts: [...this.state.agentArtifacts],
      reviews: [...this.state.reviews],
      deliveryReports: [...this.state.deliveryReports],
      events: [...this.state.events]
    };
  }

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const timestamp = now();
    const goal: Goal = {
      id: randomUUID(),
      projectName: input.projectName,
      workspacePath: input.workspacePath ?? legacyWorkspacePath(input.projectName),
      title: input.title,
      body: input.body,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.goals.push(goal);
    this.addEvent({
      type: "goal.created",
      goalId: goal.id,
      decisionId: null,
      workerSessionId: null,
      message: `Goal created: ${goal.title}`,
      metadata: {}
    });
    await this.save();

    return goal;
  }

  async updateGoalStatus(goalId: string, status: GoalStatus): Promise<Goal> {
    const goal = this.findGoal(goalId);
    goal.status = status;
    goal.updatedAt = now();
    this.addEvent({
      type: "goal.updated",
      goalId,
      decisionId: null,
      workerSessionId: null,
      message: `Goal status changed to ${status}`,
      metadata: { status }
    });
    await this.save();

    return goal;
  }

  async recordDecision(input: RecordDecisionInput): Promise<StewardDecision> {
    this.findGoal(input.goalId);

    const decision: StewardDecision = {
      id: randomUUID(),
      goalId: input.goalId,
      workerSessionId: input.workerSessionId,
      title: input.title,
      rationale: input.rationale,
      risk: input.risk,
      confidence: input.confidence,
      reversible: input.reversible,
      needsHumanReview: input.needsHumanReview,
      status: input.status,
      actionsJson: JSON.stringify(input.actions),
      createdAt: now()
    };

    this.state.decisions.push(decision);
    this.addEvent({
      type: "decision.recorded",
      goalId: decision.goalId,
      decisionId: decision.id,
      workerSessionId: decision.workerSessionId,
      message: decision.title,
      metadata: {
        risk: decision.risk,
        confidence: decision.confidence,
        needsHumanReview: decision.needsHumanReview
      }
    });
    await this.save();

    return decision;
  }

  async linkDecisionToWorkerSession(decisionId: string, workerSessionId: string): Promise<StewardDecision> {
    const decision = this.findDecision(decisionId);
    decision.workerSessionId = workerSessionId;
    await this.save();

    return decision;
  }

  async createWorkerSession(input: CreateWorkerSessionInput): Promise<WorkerSession> {
    this.findGoal(input.goalId);
    this.findDecision(input.decisionId);

    const timestamp = now();
    const session: WorkerSession = {
      id: randomUUID(),
      goalId: input.goalId,
      decisionId: input.decisionId,
      kind: input.kind,
      command: input.command,
      cwd: input.cwd,
      pid: input.pid,
      hostId: input.hostId,
      resumeId: input.resumeId,
      status: input.status,
      lastOutput: input.lastOutput ?? "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.workerSessions.push(session);
    const creationEvent =
      session.status === "failed"
        ? {
            type: "worker.failed",
            message: `${session.kind} Worker Agent failed to start`
          }
        : {
            type: "worker.started",
            message: `${session.kind} Worker Agent started`
          };
    this.addEvent({
      type: creationEvent.type,
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: creationEvent.message,
      metadata: {
        command: session.command,
        cwd: session.cwd,
        pid: session.pid,
        resumeId: session.resumeId,
        status: session.status,
        lastOutput: session.lastOutput
      }
    });
    await this.save();

    return session;
  }

  async updateWorkerSessionStatus(input: UpdateWorkerSessionStatusInput): Promise<WorkerSession> {
    const session = this.findWorkerSession(input.workerSessionId);
    const previousStatus = session.status;
    const metadata: Record<string, unknown> = {
      previousStatus,
      status: input.status
    };

    session.status = input.status;
    if (input.lastOutput !== undefined) {
      session.lastOutput = input.lastOutput;
      metadata.lastOutput = session.lastOutput;
    }
    session.updatedAt = now();

    this.addEvent({
      type: "worker.status.updated",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: `Worker session status changed from ${previousStatus} to ${session.status}`,
      metadata
    });
    await this.save();

    return session;
  }

  async createWorktreeAssignment(input: CreateWorktreeAssignmentInput): Promise<WorktreeAssignment> {
    const session = this.findWorkerSession(input.workerSessionId);
    const timestamp = now();
    const assignment: WorktreeAssignment = {
      id: randomUUID(),
      workerSessionId: input.workerSessionId,
      repositoryPath: input.repositoryPath,
      worktreePath: input.worktreePath,
      branchName: input.branchName,
      status: "planned",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.worktreeAssignments.push(assignment);
    this.addEvent({
      type: "worktree.planned",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: `Worktree planned: ${assignment.branchName}`,
      metadata: {
        repositoryPath: assignment.repositoryPath,
        worktreePath: assignment.worktreePath,
        branchName: assignment.branchName,
        status: assignment.status
      }
    });
    await this.save();

    return assignment;
  }

  async recordStewardCheckpoint(input: RecordStewardCheckpointInput): Promise<StewardCheckpoint> {
    for (const goalId of input.goalIds) {
      this.findGoal(goalId);
    }
    for (const workerSessionId of input.workerSessionIds) {
      this.findWorkerSession(workerSessionId);
    }

    const checkpoint: StewardCheckpoint = {
      id: randomUUID(),
      reason: input.reason,
      summary: input.summary,
      nextAction: input.nextAction,
      goalIds: [...input.goalIds],
      workerSessionIds: [...input.workerSessionIds],
      createdAt: now()
    };

    this.state.stewardCheckpoints.push(checkpoint);
    this.addEvent({
      type: "steward.checkpoint.recorded",
      goalId: input.goalIds[0] ?? null,
      decisionId: null,
      workerSessionId: input.workerSessionIds[0] ?? null,
      message: checkpoint.summary,
      metadata: {
        checkpointId: checkpoint.id,
        reason: checkpoint.reason,
        goalIds: checkpoint.goalIds,
        workerSessionIds: checkpoint.workerSessionIds,
        nextAction: checkpoint.nextAction
      }
    });
    await this.save();

    return checkpoint;
  }

  async recordStewardMessage(input: RecordStewardMessageInput): Promise<StewardMessage> {
    if (input.goalId !== null) {
      this.findGoal(input.goalId);
    }

    const message: StewardMessage = {
      id: randomUUID(),
      role: input.role,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      body: input.body,
      createdAt: now()
    };

    this.state.stewardMessages.push(message);
    this.addEvent({
      type: "steward.message.recorded",
      goalId: message.goalId,
      decisionId: null,
      workerSessionId: null,
      message: `${message.role} Steward chat message recorded`,
      metadata: {
        stewardMessageId: message.id,
        role: message.role,
        projectName: message.projectName,
        workspacePath: message.workspacePath
      }
    });
    await this.save();

    return message;
  }

  async listStewardMessages(filter: ListStewardMessagesFilter = {}): Promise<StewardMessage[]> {
    return this.state.stewardMessages.filter((message) => {
      if (filter.projectName !== undefined && message.projectName !== filter.projectName) {
        return false;
      }

      if (filter.workspacePath !== undefined && message.workspacePath !== filter.workspacePath) {
        return false;
      }

      return true;
    });
  }

  async addCorrection(input: AddCorrectionInput): Promise<DecisionCorrection> {
    const decision = this.findDecision(input.decisionId);
    decision.status = "corrected";

    const correction: DecisionCorrection = {
      id: randomUUID(),
      decisionId: input.decisionId,
      body: input.body,
      createdBy: input.createdBy,
      createdAt: now()
    };

    this.state.corrections.push(correction);
    this.addEvent({
      type: "correction.recorded",
      goalId: decision.goalId,
      decisionId: decision.id,
      workerSessionId: decision.workerSessionId,
      message: "Human correction recorded",
      metadata: {
        correctionId: correction.id,
        body: correction.body
      }
    });
    await this.save();

    return correction;
  }

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryEntry> {
    const existing = this.state.memories.find(
      (memory) =>
        memory.scope === input.scope && memory.projectName === input.projectName && memory.key === input.key
    );

    if (existing !== undefined) {
      existing.value = input.value;
      existing.sourceCorrectionId = input.sourceCorrectionId;
      existing.updatedAt = now();
      await this.save();
      return existing;
    }

    const timestamp = now();
    const memory: MemoryEntry = {
      id: randomUUID(),
      scope: input.scope,
      projectName: input.projectName,
      key: input.key,
      value: input.value,
      sourceCorrectionId: input.sourceCorrectionId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.memories.push(memory);
    await this.save();

    return memory;
  }

  async createExecutionNode(input: UpsertExecutionNodeInput): Promise<ExecutionNode> {
    return this.upsertExecutionNode(input);
  }

  async upsertExecutionNode(input: UpsertExecutionNodeInput): Promise<ExecutionNode> {
    const existing = this.state.executionNodes.find((node) => node.name === input.name);

    if (existing !== undefined) {
      existing.kind = input.kind;
      existing.status = input.status;
      existing.sshHost = input.sshHost;
      existing.workRoot = input.workRoot;
      existing.proxyUrl = input.proxyUrl;
      existing.updatedAt = now();
      this.addEvent({
        type: "execution_node.updated",
        goalId: null,
        decisionId: null,
        workerSessionId: null,
        message: `Execution node updated: ${existing.name}`,
        metadata: {
          executionNodeId: existing.id,
          name: existing.name,
          kind: existing.kind,
          status: existing.status,
          sshHost: existing.sshHost,
          workRoot: existing.workRoot,
          proxyUrl: existing.proxyUrl
        }
      });
      await this.save();
      return existing;
    }

    const timestamp = now();
    const node: ExecutionNode = {
      id: randomUUID(),
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.executionNodes.push(node);
    this.addEvent({
      type: "execution_node.registered",
      goalId: null,
      decisionId: null,
      workerSessionId: null,
      message: `Execution node registered: ${node.name}`,
      metadata: {
        executionNodeId: node.id,
        name: node.name,
        kind: node.kind,
        status: node.status,
        sshHost: node.sshHost,
        workRoot: node.workRoot,
        proxyUrl: node.proxyUrl
      }
    });
    await this.save();

    return node;
  }

  async recordAgentArtifact(input: RecordAgentArtifactInput): Promise<AgentArtifact> {
    this.findGoal(input.goalId);
    this.assertResourceExists(input.resourceId);

    const artifact: AgentArtifact = {
      id: randomUUID(),
      goalId: input.goalId,
      role: input.role,
      kind: input.kind,
      title: input.title,
      path: input.path,
      content: input.content,
      resourceId: input.resourceId,
      createdAt: now()
    };

    this.state.agentArtifacts.push(artifact);
    this.addEvent({
      type: "artifact.recorded",
      goalId: artifact.goalId,
      decisionId: null,
      workerSessionId: null,
      message: `Artifact recorded: ${artifact.title}`,
      metadata: {
        artifactId: artifact.id,
        role: artifact.role,
        kind: artifact.kind,
        path: artifact.path,
        resourceId: artifact.resourceId
      }
    });
    await this.save();

    return artifact;
  }

  async recordReviewResult(input: RecordReviewResultInput): Promise<ReviewResult> {
    this.findGoal(input.goalId);
    this.assertResourceExists(input.resourceId);
    for (const artifactId of input.artifactIds) {
      this.findArtifact(artifactId);
    }

    const review: ReviewResult = {
      id: randomUUID(),
      goalId: input.goalId,
      reviewer: input.reviewer,
      status: input.status,
      summary: input.summary,
      artifactIds: [...input.artifactIds],
      resourceId: input.resourceId,
      createdAt: now()
    };

    this.state.reviews.push(review);
    this.addEvent({
      type: "review.recorded",
      goalId: review.goalId,
      decisionId: null,
      workerSessionId: null,
      message: `Review ${review.status}: ${review.reviewer}`,
      metadata: {
        reviewId: review.id,
        reviewer: review.reviewer,
        status: review.status,
        artifactIds: review.artifactIds,
        resourceId: review.resourceId
      }
    });
    await this.save();

    return review;
  }

  async recordDeliveryReport(input: RecordDeliveryReportInput): Promise<DeliveryReport> {
    this.findGoal(input.goalId);
    this.assertResourceExists(input.resourceId);
    for (const artifactId of input.artifactIds) {
      this.findArtifact(artifactId);
    }
    for (const reviewResultId of input.reviewResultIds) {
      this.findReview(reviewResultId);
    }

    const timestamp = now();
    const report: DeliveryReport = {
      id: randomUUID(),
      goalId: input.goalId,
      status: input.status,
      markdown: input.markdown,
      artifactIds: [...input.artifactIds],
      reviewResultIds: [...input.reviewResultIds],
      resourceId: input.resourceId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.deliveryReports.push(report);
    this.addEvent({
      type: input.status === "delivered" ? "delivery.completed" : "delivery.failed",
      goalId: report.goalId,
      decisionId: null,
      workerSessionId: null,
      message: `Delivery report ${report.status}`,
      metadata: {
        deliveryReportId: report.id,
        status: report.status,
        artifactIds: report.artifactIds,
        reviewResultIds: report.reviewResultIds,
        resourceId: report.resourceId
      }
    });
    await this.save();

    return report;
  }

  private findGoal(goalId: string): Goal {
    const goal = this.state.goals.find((item) => item.id === goalId);
    if (goal === undefined) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    return goal;
  }

  private findArtifact(artifactId: string): AgentArtifact {
    const artifact = this.state.agentArtifacts.find((item) => item.id === artifactId);

    if (artifact === undefined) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    return artifact;
  }

  private findReview(reviewId: string): ReviewResult {
    const review = this.state.reviews.find((item) => item.id === reviewId);

    if (review === undefined) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    return review;
  }

  private assertResourceExists(resourceId: string | null): void {
    if (resourceId === null) {
      return;
    }

    if (this.state.executionNodes.every((node) => node.id !== resourceId)) {
      throw new Error(`Execution node not found: ${resourceId}`);
    }
  }

  private findDecision(decisionId: string): StewardDecision {
    const decision = this.state.decisions.find((item) => item.id === decisionId);
    if (decision === undefined) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    return decision;
  }

  private findWorkerSession(workerSessionId: string): WorkerSession {
    const session = this.state.workerSessions.find((item) => item.id === workerSessionId);
    if (session === undefined) {
      throw new Error(`Worker session not found: ${workerSessionId}`);
    }

    return session;
  }

  private addEvent(input: {
    type: string;
    goalId: string | null;
    decisionId: string | null;
    workerSessionId: string | null;
    message: string;
    metadata: Record<string, unknown>;
  }): ControlPlaneEvent {
    const event: ControlPlaneEvent = {
      id: randomUUID(),
      type: input.type,
      goalId: input.goalId,
      decisionId: input.decisionId,
      workerSessionId: input.workerSessionId,
      message: input.message,
      metadataJson: JSON.stringify(input.metadata),
      createdAt: now()
    };

    this.state.events.push(event);
    return event;
  }

  private async save(): Promise<void> {
    await writeFile(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }
}
