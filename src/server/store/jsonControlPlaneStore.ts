import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AgentArtifact,
  AgentProviderType,
  AgentRole,
  ArtifactKind,
  ControlPlaneEvent,
  Conversation,
  ConversationBinding,
  ConversationTransport,
  DashboardData,
  DecisionCorrection,
  DecisionRisk,
  DecisionStatus,
  DeliveryReport,
  DeliveryStatus,
  ExecutionNode,
  MessageDelivery,
  MessageDeliveryDirection,
  MessageDeliveryStatus,
  Goal,
  GoalStatus,
  GithubDeployKeyCleanupStatus,
  GithubDeployKeyLease,
  MemoryEntry,
  MemoryScope,
  ReviewResult,
  ReviewStatus,
  StewardCheckpoint,
  StewardCheckpointReason,
  StewardDecision,
  StewardMessage,
  StewardMessageRole,
  WorkerReport,
  WorkerReportStatus,
  WorkerKind,
  WorktreeAssignment,
  WorkerSession,
  WorkerSessionStatus
} from "../../shared/types.js";

interface ControlPlaneState
  extends Omit<
    DashboardData,
    "stewardMessages" | "workerReports" | "conversations" | "conversationBindings" | "messageDeliveries"
  > {
  version: 1;
  stewardMessages: StewardMessage[];
  workerReports: WorkerReport[];
  conversations: Conversation[];
  conversationBindings: ConversationBinding[];
  messageDeliveries: MessageDelivery[];
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
  providerId?: string | null;
  providerType?: AgentProviderType | null;
  model?: string | null;
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

export interface UpdateWorkerSessionLaunchInput {
  workerSessionId: string;
  kind?: WorkerKind;
  providerId?: string | null;
  providerType?: AgentProviderType | null;
  model?: string | null;
  command: string;
  cwd: string;
  pid: number | null;
  resumeId: string | null;
  status: WorkerSessionStatus;
  lastOutput?: string;
}

export interface RecordWorkerReportInput {
  goalId: string;
  workerSessionId: string;
  status: WorkerReportStatus;
  changedFiles: string[];
  verification: string[];
  decisions: string[];
  blockers: string[];
  nextActions: string[];
  needsOwnerReview: boolean;
  resumeId: string | null;
  returnedRef?: string | null;
  returnedSha?: string | null;
  markdown: string;
}

export interface CreateWorktreeAssignmentInput {
  workerSessionId: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
}

export interface AcquireGithubDeployKeyLeaseInput {
  projectName: string;
  workspacePath: string;
  repositoryUrl: string;
  repositorySlug: string;
  githubDeployKeyId: string | null;
  publicKeyFingerprint: string;
  localPrivateKeyPath: string;
  remoteNodeId: string;
  remotePrivateKeyPath: string;
  workerSessionId: string;
  expiresAt: string;
  now?: string;
}

export interface RenewGithubDeployKeyLeaseInput {
  leaseId: string;
  workerSessionId: string;
  expiresAt: string;
  now?: string;
}

export interface ReleaseGithubDeployKeyLeaseInput {
  leaseId: string;
  workerSessionId: string;
  now?: string;
}

export interface UpdateGithubDeployKeyLeaseCleanupInput {
  leaseId: string;
  cleanupStatus: GithubDeployKeyCleanupStatus;
  now?: string;
}

export interface ExpireGithubDeployKeyLeasesInput {
  now?: string;
}

export interface RecordStewardCheckpointInput {
  reason: StewardCheckpointReason;
  summary: string;
  nextAction: string;
  goalIds: string[];
  workerSessionIds: string[];
  metadata?: Record<string, unknown>;
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

export type UpsertExecutionNodeInput = Omit<ExecutionNode, "id" | "createdAt" | "updatedAt" | "tags" | "capacity"> &
  Partial<Pick<ExecutionNode, "tags" | "capacity">>;

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

export interface UpsertConversationInput {
  id?: string;
  transport: ConversationTransport;
  projectName: string | null;
  workspacePath: string | null;
  externalConversationId?: string | null;
  title?: string | null;
}

export interface ListConversationsFilter {
  transport?: ConversationTransport;
  projectName?: string;
  workspacePath?: string;
}

export interface BindConversationInput {
  conversationId: string;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
}

export interface ListConversationBindingsFilter {
  conversationId?: string;
  projectName?: string;
  workspacePath?: string;
  goalId?: string;
}

export interface RecordMessageDeliveryInput {
  conversationId: string;
  stewardMessageId: string | null;
  transport?: ConversationTransport;
  direction: MessageDeliveryDirection;
  externalMessageId?: string | null;
  idempotencyKey?: string | null;
  deliveryStatus: MessageDeliveryStatus;
}

export interface RecordMessageDeliveryResult {
  delivery: MessageDelivery;
  duplicate: boolean;
  duplicateOf: string | null;
}

export interface RecordStewardMessageInput {
  role: StewardMessageRole;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
  conversationId?: string | null;
  transport?: ConversationTransport | null;
  externalMessageId?: string | null;
  idempotencyKey?: string | null;
  senderDisplay?: string | null;
  deliveryStatus?: MessageDeliveryStatus | null;
  body: string;
}

export interface ListStewardMessagesFilter {
  conversationId?: string;
  projectName?: string;
  workspacePath?: string;
  goalId?: string;
  transport?: ConversationTransport;
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
    githubDeployKeyLeases: [],
    worktreeAssignments: [],
    stewardCheckpoints: [],
    stewardMessages: [],
    workerReports: [],
    conversations: [],
    conversationBindings: [],
    messageDeliveries: [],
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
    workerSessions: (parsed.workerSessions ?? []).map(normalizeWorkerSession),
    corrections: parsed.corrections ?? [],
    memories: parsed.memories ?? [],
    executionNodes: (parsed.executionNodes ?? []).map(normalizeExecutionNode),
    githubDeployKeyLeases: (parsed.githubDeployKeyLeases ?? []).map(normalizeGithubDeployKeyLease),
    worktreeAssignments: parsed.worktreeAssignments ?? [],
    stewardCheckpoints: parsed.stewardCheckpoints ?? [],
    stewardMessages: (parsed.stewardMessages ?? []).map(normalizeStewardMessage),
    workerReports: parsed.workerReports ?? [],
    conversations: parsed.conversations ?? [],
    conversationBindings: parsed.conversationBindings ?? [],
    messageDeliveries: parsed.messageDeliveries ?? [],
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

function normalizeExecutionNode(
  node: ExecutionNode | (Omit<ExecutionNode, "tags" | "capacity"> & Partial<Pick<ExecutionNode, "tags" | "capacity">>)
): ExecutionNode {
  return {
    ...node,
    tags: normalizeTags(node.tags),
    capacity: normalizeCapacity(node.capacity)
  };
}

function normalizeStewardMessage(message: StewardMessage): StewardMessage {
  return {
    ...message,
    conversationId: message.conversationId ?? null,
    transport: message.transport ?? null,
    externalMessageId: message.externalMessageId ?? null,
    idempotencyKey: message.idempotencyKey ?? null,
    senderDisplay: message.senderDisplay ?? null,
    deliveryStatus: message.deliveryStatus ?? null
  };
}

function normalizeWorkerSession(
  session: WorkerSession | (Omit<WorkerSession, "providerId" | "providerType" | "model"> & {
    providerId?: string | null;
    providerType?: AgentProviderType | null;
    model?: string | null;
  })
): WorkerSession {
  return {
    ...session,
    providerId: nullableString(session.providerId),
    providerType: normalizeProviderTypeOrNull(session.providerType),
    model: nullableString(session.model)
  };
}

function normalizeGithubDeployKeyLease(
  lease: GithubDeployKeyLease | (Omit<GithubDeployKeyLease, "refcount"> & { refcount?: number })
): GithubDeployKeyLease {
  const activeWorkerSessionIds = Array.isArray(lease.activeWorkerSessionIds)
    ? lease.activeWorkerSessionIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
    : [];

  return {
    ...lease,
    activeWorkerSessionIds,
    refcount: activeWorkerSessionIds.length
  };
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag !== "")
    )
  ];
}

function normalizeCapacity(capacity: unknown): number {
  if (typeof capacity !== "number" || !Number.isFinite(capacity)) {
    return 1;
  }

  return Math.max(1, Math.floor(capacity));
}

function nullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeProviderTypeOrNull(value: AgentProviderType | null | undefined): AgentProviderType | null {
  if (
    value === "codex" ||
    value === "claude" ||
    value === "gemini" ||
    value === "custom" ||
    value === "claude_code" ||
    value === "gemini_cli"
  ) {
    return value;
  }

  return null;
}

function addUniqueWorkerSession(lease: GithubDeployKeyLease, workerSessionId: string): void {
  if (!lease.activeWorkerSessionIds.includes(workerSessionId)) {
    lease.activeWorkerSessionIds.push(workerSessionId);
  }

  lease.refcount = lease.activeWorkerSessionIds.length;
}

function githubDeployKeyLeaseEventMetadata(lease: GithubDeployKeyLease): Record<string, unknown> {
  return {
    leaseId: lease.id,
    projectName: lease.projectName,
    workspacePath: lease.workspacePath,
    repositoryUrl: lease.repositoryUrl,
    repositorySlug: lease.repositorySlug,
    githubDeployKeyId: lease.githubDeployKeyId,
    publicKeyFingerprint: lease.publicKeyFingerprint,
    localPrivateKeyPath: lease.localPrivateKeyPath,
    remoteNodeId: lease.remoteNodeId,
    remotePrivateKeyPath: lease.remotePrivateKeyPath,
    activeWorkerSessionIds: lease.activeWorkerSessionIds,
    refcount: lease.refcount,
    status: lease.status,
    cleanupStatus: lease.cleanupStatus,
    expiresAt: lease.expiresAt,
    releasedAt: lease.releasedAt
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
      githubDeployKeyLeases: [...this.state.githubDeployKeyLeases],
      worktreeAssignments: [...this.state.worktreeAssignments],
      stewardCheckpoints: [...this.state.stewardCheckpoints],
      workerReports: [...this.state.workerReports],
      stewardMessages: [...this.state.stewardMessages],
      conversations: [...this.state.conversations],
      conversationBindings: [...this.state.conversationBindings],
      messageDeliveries: [...this.state.messageDeliveries],
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
      providerId: nullableString(input.providerId),
      providerType: normalizeProviderTypeOrNull(input.providerType),
      model: nullableString(input.model),
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
        providerId: session.providerId,
        providerType: session.providerType,
        model: session.model,
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

  async updateWorkerSessionLaunch(input: UpdateWorkerSessionLaunchInput): Promise<WorkerSession> {
    const session = this.findWorkerSession(input.workerSessionId);
    const previousStatus = session.status;

    session.command = input.command;
    if (input.kind !== undefined) {
      session.kind = input.kind;
    }
    if (input.providerId !== undefined) {
      session.providerId = nullableString(input.providerId);
    }
    if (input.providerType !== undefined) {
      session.providerType = normalizeProviderTypeOrNull(input.providerType);
    }
    if (input.model !== undefined) {
      session.model = nullableString(input.model);
    }
    session.cwd = input.cwd;
    session.pid = input.pid;
    session.resumeId = input.resumeId;
    session.status = input.status;
    if (input.lastOutput !== undefined) {
      session.lastOutput = input.lastOutput;
    }
    session.updatedAt = now();

    this.addEvent({
      type: input.status === "failed" ? "worker.failed" : "worker.launch.updated",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message:
        input.status === "failed"
          ? `${session.kind} Worker Agent failed to start`
          : `${session.kind} Worker Agent launch details updated`,
      metadata: {
        previousStatus,
        command: session.command,
        providerId: session.providerId,
        providerType: session.providerType,
        model: session.model,
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

  async recordWorkerReport(input: RecordWorkerReportInput): Promise<WorkerReport> {
    const goal = this.findGoal(input.goalId);
    const session = this.findWorkerSession(input.workerSessionId);

    if (session.goalId !== goal.id) {
      throw new Error(`Worker session ${session.id} does not belong to goal ${goal.id}`);
    }

    const report: WorkerReport = {
      id: randomUUID(),
      goalId: goal.id,
      workerSessionId: session.id,
      status: input.status,
      changedFiles: [...input.changedFiles],
      verification: [...input.verification],
      decisions: [...input.decisions],
      blockers: [...input.blockers],
      nextActions: [...input.nextActions],
      needsOwnerReview: input.needsOwnerReview,
      resumeId: input.resumeId,
      returnedRef: input.returnedRef ?? null,
      returnedSha: input.returnedSha ?? null,
      markdown: input.markdown,
      createdAt: now()
    };

    this.state.workerReports.push(report);
    this.addEvent({
      type: "worker.report.recorded",
      goalId: report.goalId,
      decisionId: session.decisionId,
      workerSessionId: report.workerSessionId,
      message: `Worker report recorded: ${report.status}`,
      metadata: {
        workerReportId: report.id,
        status: report.status,
        changedFiles: report.changedFiles,
        verification: report.verification,
        blockers: report.blockers,
        nextActions: report.nextActions,
        needsOwnerReview: report.needsOwnerReview,
        resumeId: report.resumeId,
        returnedRef: report.returnedRef ?? null,
        returnedSha: report.returnedSha ?? null
      }
    });
    await this.save();

    return report;
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

  async acquireGithubDeployKeyLease(input: AcquireGithubDeployKeyLeaseInput): Promise<GithubDeployKeyLease> {
    const session = this.findWorkerSession(input.workerSessionId);
    this.findExecutionNode(input.remoteNodeId);

    const timestamp = input.now ?? now();
    const existing = this.state.githubDeployKeyLeases.find(
      (lease) =>
        lease.status === "active" &&
        lease.projectName === input.projectName &&
        lease.workspacePath === input.workspacePath &&
        lease.repositoryUrl === input.repositoryUrl &&
        lease.repositorySlug === input.repositorySlug &&
        lease.publicKeyFingerprint === input.publicKeyFingerprint &&
        lease.remoteNodeId === input.remoteNodeId
    );

    if (existing !== undefined) {
      addUniqueWorkerSession(existing, input.workerSessionId);
      existing.githubDeployKeyId = input.githubDeployKeyId;
      existing.localPrivateKeyPath = input.localPrivateKeyPath;
      existing.remotePrivateKeyPath = input.remotePrivateKeyPath;
      existing.cleanupStatus = "not_requested";
      existing.lastHeartbeatAt = timestamp;
      existing.expiresAt = input.expiresAt;
      existing.updatedAt = timestamp;
      this.addEvent({
        type: "github_deploy_key_lease.acquired",
        goalId: session.goalId,
        decisionId: session.decisionId,
        workerSessionId: session.id,
        message: `GitHub deploy-key lease acquired for ${existing.repositorySlug}`,
        metadata: githubDeployKeyLeaseEventMetadata(existing)
      });
      await this.save();
      return existing;
    }

    const lease: GithubDeployKeyLease = {
      id: randomUUID(),
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      repositoryUrl: input.repositoryUrl,
      repositorySlug: input.repositorySlug,
      githubDeployKeyId: input.githubDeployKeyId,
      publicKeyFingerprint: input.publicKeyFingerprint,
      localPrivateKeyPath: input.localPrivateKeyPath,
      remoteNodeId: input.remoteNodeId,
      remotePrivateKeyPath: input.remotePrivateKeyPath,
      activeWorkerSessionIds: [input.workerSessionId],
      refcount: 1,
      status: "active",
      cleanupStatus: "not_requested",
      acquiredAt: timestamp,
      lastHeartbeatAt: timestamp,
      expiresAt: input.expiresAt,
      releasedAt: null,
      updatedAt: timestamp
    };

    this.state.githubDeployKeyLeases.push(lease);
    this.addEvent({
      type: "github_deploy_key_lease.acquired",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: `GitHub deploy-key lease acquired for ${lease.repositorySlug}`,
      metadata: githubDeployKeyLeaseEventMetadata(lease)
    });
    await this.save();

    return lease;
  }

  async renewGithubDeployKeyLease(input: RenewGithubDeployKeyLeaseInput): Promise<GithubDeployKeyLease> {
    const lease = this.findGithubDeployKeyLease(input.leaseId);
    const session = this.findWorkerSession(input.workerSessionId);

    if (!lease.activeWorkerSessionIds.includes(input.workerSessionId)) {
      throw new Error(`Worker session ${input.workerSessionId} does not hold GitHub deploy-key lease ${lease.id}`);
    }

    const timestamp = input.now ?? now();
    lease.lastHeartbeatAt = timestamp;
    lease.expiresAt = input.expiresAt;
    lease.updatedAt = timestamp;
    this.addEvent({
      type: "github_deploy_key_lease.renewed",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: `GitHub deploy-key lease renewed for ${lease.repositorySlug}`,
      metadata: githubDeployKeyLeaseEventMetadata(lease)
    });
    await this.save();

    return lease;
  }

  async releaseGithubDeployKeyLease(input: ReleaseGithubDeployKeyLeaseInput): Promise<GithubDeployKeyLease> {
    const lease = this.findGithubDeployKeyLease(input.leaseId);
    const session = this.findWorkerSession(input.workerSessionId);
    const timestamp = input.now ?? now();

    lease.activeWorkerSessionIds = lease.activeWorkerSessionIds.filter((id) => id !== input.workerSessionId);
    lease.refcount = lease.activeWorkerSessionIds.length;
    lease.updatedAt = timestamp;
    if (lease.refcount === 0) {
      lease.status = "released";
      lease.cleanupStatus = "pending";
      lease.releasedAt = timestamp;
    }

    this.addEvent({
      type: "github_deploy_key_lease.released",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: `GitHub deploy-key lease released for ${lease.repositorySlug}`,
      metadata: githubDeployKeyLeaseEventMetadata(lease)
    });
    await this.save();

    return lease;
  }

  async updateGithubDeployKeyLeaseCleanup(input: UpdateGithubDeployKeyLeaseCleanupInput): Promise<GithubDeployKeyLease> {
    const lease = this.findGithubDeployKeyLease(input.leaseId);
    const timestamp = input.now ?? now();

    lease.cleanupStatus = input.cleanupStatus;
    lease.updatedAt = timestamp;
    this.addEvent({
      type: "github_deploy_key_lease.cleanup_updated",
      goalId: null,
      decisionId: null,
      workerSessionId: null,
      message: `GitHub deploy-key lease cleanup ${lease.cleanupStatus} for ${lease.repositorySlug}`,
      metadata: githubDeployKeyLeaseEventMetadata(lease)
    });
    await this.save();

    return lease;
  }

  async expireGithubDeployKeyLeases(input: ExpireGithubDeployKeyLeasesInput = {}): Promise<{ expiredLeaseIds: string[] }> {
    const timestamp = input.now ?? now();
    const expiredLeaseIds: string[] = [];

    for (const lease of this.state.githubDeployKeyLeases) {
      if (lease.status !== "active" || Date.parse(lease.expiresAt) > Date.parse(timestamp)) {
        continue;
      }

      lease.activeWorkerSessionIds = [];
      lease.refcount = 0;
      lease.status = "stale";
      lease.cleanupStatus = "pending";
      lease.releasedAt = timestamp;
      lease.updatedAt = timestamp;
      expiredLeaseIds.push(lease.id);
      this.addEvent({
        type: "github_deploy_key_lease.expired",
        goalId: null,
        decisionId: null,
        workerSessionId: null,
        message: `GitHub deploy-key lease expired for ${lease.repositorySlug}`,
        metadata: githubDeployKeyLeaseEventMetadata(lease)
      });
    }

    if (expiredLeaseIds.length > 0) {
      await this.save();
    }

    return { expiredLeaseIds };
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
        nextAction: checkpoint.nextAction,
        ...(input.metadata ?? {})
      }
    });
    await this.save();

    return checkpoint;
  }

  async upsertConversation(input: UpsertConversationInput): Promise<Conversation> {
    const externalConversationId = nullableString(input.externalConversationId);
    const title = nullableString(input.title);
    const existing =
      input.id === undefined
        ? externalConversationId === null
          ? undefined
          : this.state.conversations.find(
              (conversation) =>
                conversation.transport === input.transport && conversation.externalConversationId === externalConversationId
            )
        : this.state.conversations.find((conversation) => conversation.id === input.id);

    if (existing !== undefined) {
      existing.transport = input.transport;
      existing.projectName = input.projectName;
      existing.workspacePath = input.workspacePath;
      existing.externalConversationId = externalConversationId;
      existing.title = title;
      existing.updatedAt = now();
      this.addEvent({
        type: "conversation.updated",
        goalId: null,
        decisionId: null,
        workerSessionId: null,
        message: `Conversation updated: ${existing.transport}`,
        metadata: {
          conversationId: existing.id,
          transport: existing.transport,
          projectName: existing.projectName,
          workspacePath: existing.workspacePath,
          externalConversationId: existing.externalConversationId,
          title: existing.title
        }
      });
      await this.save();
      return existing;
    }

    const timestamp = now();
    const conversation: Conversation = {
      id: input.id ?? randomUUID(),
      transport: input.transport,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      externalConversationId,
      title,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.conversations.push(conversation);
    this.addEvent({
      type: "conversation.created",
      goalId: null,
      decisionId: null,
      workerSessionId: null,
      message: `Conversation created: ${conversation.transport}`,
      metadata: {
        conversationId: conversation.id,
        transport: conversation.transport,
        projectName: conversation.projectName,
        workspacePath: conversation.workspacePath,
        externalConversationId: conversation.externalConversationId,
        title: conversation.title
      }
    });
    await this.save();

    return conversation;
  }

  async listConversations(filter: ListConversationsFilter = {}): Promise<Conversation[]> {
    return this.state.conversations.filter((conversation) => {
      if (filter.transport !== undefined && conversation.transport !== filter.transport) {
        return false;
      }

      if (filter.projectName !== undefined && conversation.projectName !== filter.projectName) {
        return false;
      }

      if (filter.workspacePath !== undefined && conversation.workspacePath !== filter.workspacePath) {
        return false;
      }

      return true;
    });
  }

  async bindConversation(input: BindConversationInput): Promise<ConversationBinding> {
    this.findConversation(input.conversationId);
    if (input.goalId !== null) {
      this.findGoal(input.goalId);
    }

    const existing = this.state.conversationBindings.find(
      (binding) =>
        binding.conversationId === input.conversationId &&
        binding.projectName === input.projectName &&
        binding.workspacePath === input.workspacePath &&
        binding.goalId === input.goalId
    );

    if (existing !== undefined) {
      existing.updatedAt = now();
      await this.save();
      return existing;
    }

    const timestamp = now();
    const binding: ConversationBinding = {
      id: randomUUID(),
      conversationId: input.conversationId,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.conversationBindings.push(binding);
    this.addEvent({
      type: "conversation.bound",
      goalId: binding.goalId,
      decisionId: null,
      workerSessionId: null,
      message: "Conversation binding recorded",
      metadata: {
        bindingId: binding.id,
        conversationId: binding.conversationId,
        projectName: binding.projectName,
        workspacePath: binding.workspacePath,
        goalId: binding.goalId
      }
    });
    await this.save();

    return binding;
  }

  async listConversationBindings(filter: ListConversationBindingsFilter = {}): Promise<ConversationBinding[]> {
    return this.state.conversationBindings.filter((binding) => {
      if (filter.conversationId !== undefined && binding.conversationId !== filter.conversationId) {
        return false;
      }

      if (filter.projectName !== undefined && binding.projectName !== filter.projectName) {
        return false;
      }

      if (filter.workspacePath !== undefined && binding.workspacePath !== filter.workspacePath) {
        return false;
      }

      if (filter.goalId !== undefined && binding.goalId !== filter.goalId) {
        return false;
      }

      return true;
    });
  }

  async recordMessageDelivery(input: RecordMessageDeliveryInput): Promise<RecordMessageDeliveryResult> {
    const conversation = this.findConversation(input.conversationId);
    const stewardMessage = input.stewardMessageId === null ? null : this.findStewardMessage(input.stewardMessageId);
    const transport = input.transport ?? conversation.transport;
    const externalMessageId = nullableString(input.externalMessageId);
    const idempotencyKey = nullableString(input.idempotencyKey);

    if (
      stewardMessage?.conversationId !== undefined &&
      stewardMessage.conversationId !== null &&
      stewardMessage.conversationId !== conversation.id
    ) {
      throw new Error(`Steward message ${stewardMessage.id} does not belong to conversation ${conversation.id}`);
    }

    const duplicate =
      input.direction === "inbound"
        ? this.state.messageDeliveries.find(
            (delivery) =>
              delivery.conversationId === conversation.id &&
              delivery.transport === transport &&
              delivery.direction === input.direction &&
              ((idempotencyKey !== null && delivery.idempotencyKey === idempotencyKey) ||
                (externalMessageId !== null && delivery.externalMessageId === externalMessageId))
          )
        : undefined;

    if (duplicate !== undefined) {
      this.addEvent({
        type: "message_delivery.duplicate_detected",
        goalId: stewardMessage?.goalId ?? null,
        decisionId: null,
        workerSessionId: null,
        message: "Duplicate inbound message delivery detected",
        metadata: {
          deliveryId: duplicate.id,
          conversationId: duplicate.conversationId,
          stewardMessageId: duplicate.stewardMessageId,
          transport: duplicate.transport,
          externalMessageId,
          idempotencyKey
        }
      });
      await this.save();
      return { delivery: duplicate, duplicate: true, duplicateOf: duplicate.id };
    }

    const timestamp = now();
    const delivery: MessageDelivery = {
      id: randomUUID(),
      conversationId: conversation.id,
      stewardMessageId: stewardMessage?.id ?? null,
      transport,
      direction: input.direction,
      externalMessageId,
      idempotencyKey,
      deliveryStatus: input.deliveryStatus,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.messageDeliveries.push(delivery);
    this.addEvent({
      type: "message_delivery.recorded",
      goalId: stewardMessage?.goalId ?? null,
      decisionId: null,
      workerSessionId: null,
      message: `Message delivery recorded: ${delivery.deliveryStatus}`,
      metadata: {
        deliveryId: delivery.id,
        conversationId: delivery.conversationId,
        stewardMessageId: delivery.stewardMessageId,
        transport: delivery.transport,
        direction: delivery.direction,
        externalMessageId: delivery.externalMessageId,
        idempotencyKey: delivery.idempotencyKey,
        deliveryStatus: delivery.deliveryStatus
      }
    });
    await this.save();

    return { delivery, duplicate: false, duplicateOf: null };
  }

  async recordStewardMessage(input: RecordStewardMessageInput): Promise<StewardMessage> {
    if (input.goalId !== null) {
      this.findGoal(input.goalId);
    }

    const conversation = input.conversationId === null || input.conversationId === undefined ? null : this.findConversation(input.conversationId);
    const message: StewardMessage = {
      id: randomUUID(),
      role: input.role,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      conversationId: conversation?.id ?? null,
      transport: input.transport ?? conversation?.transport ?? null,
      externalMessageId: nullableString(input.externalMessageId),
      idempotencyKey: nullableString(input.idempotencyKey),
      senderDisplay: nullableString(input.senderDisplay),
      deliveryStatus: input.deliveryStatus ?? null,
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
        conversationId: message.conversationId,
        transport: message.transport,
        externalMessageId: message.externalMessageId,
        idempotencyKey: message.idempotencyKey,
        projectName: message.projectName,
        workspacePath: message.workspacePath,
        senderDisplay: message.senderDisplay,
        deliveryStatus: message.deliveryStatus
      }
    });
    await this.save();

    return message;
  }

  async listStewardMessages(filter: ListStewardMessagesFilter = {}): Promise<StewardMessage[]> {
    return this.state.stewardMessages.filter((message) => {
      if (filter.conversationId !== undefined && message.conversationId !== filter.conversationId) {
        return false;
      }

      if (filter.projectName !== undefined && message.projectName !== filter.projectName) {
        return false;
      }

      if (filter.workspacePath !== undefined && message.workspacePath !== filter.workspacePath) {
        return false;
      }

      if (filter.goalId !== undefined && message.goalId !== filter.goalId) {
        return false;
      }

      if (filter.transport !== undefined && message.transport !== filter.transport) {
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
      existing.tags = normalizeTags(input.tags);
      existing.capacity = normalizeCapacity(input.capacity);
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
          proxyUrl: existing.proxyUrl,
          tags: existing.tags,
          capacity: existing.capacity
        }
      });
      await this.save();
      return existing;
    }

    const timestamp = now();
    const node: ExecutionNode = {
      id: randomUUID(),
      ...input,
      tags: normalizeTags(input.tags),
      capacity: normalizeCapacity(input.capacity),
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
        proxyUrl: node.proxyUrl,
        tags: node.tags,
        capacity: node.capacity
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

  private findExecutionNode(nodeId: string): ExecutionNode {
    const node = this.state.executionNodes.find((item) => item.id === nodeId);
    if (node === undefined) {
      throw new Error(`Execution node not found: ${nodeId}`);
    }

    return node;
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

  private findConversation(conversationId: string): Conversation {
    const conversation = this.state.conversations.find((item) => item.id === conversationId);
    if (conversation === undefined) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    return conversation;
  }

  private findStewardMessage(stewardMessageId: string): StewardMessage {
    const message = this.state.stewardMessages.find((item) => item.id === stewardMessageId);
    if (message === undefined) {
      throw new Error(`Steward message not found: ${stewardMessageId}`);
    }

    return message;
  }

  private findGithubDeployKeyLease(leaseId: string): GithubDeployKeyLease {
    const lease = this.state.githubDeployKeyLeases.find((item) => item.id === leaseId);
    if (lease === undefined) {
      throw new Error(`GitHub deploy-key lease not found: ${leaseId}`);
    }

    return lease;
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
