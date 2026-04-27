export type GoalStatus = "queued" | "running" | "blocked" | "completed" | "cancelled";
export type AgentProviderType = "codex" | "claude" | "gemini" | "custom" | "claude_code" | "gemini_cli";
export type AgentProviderRole = "steward" | "worker";
export type WorkerKind = AgentProviderType;
export type WorkerSessionStatus = "starting" | "running" | "paused" | "completed" | "failed";
export type DecisionRisk = "low" | "medium" | "high";
export type DecisionStatus = "active" | "corrected" | "superseded";
export type MemoryScope = "user" | "project";
export type StewardCheckpointReason = "dispatch" | "correction" | "recovery" | "crash" | "manual";
export type AgentRole = "researcher" | "planner" | "worker" | "reviewer" | "deliverer";
export type ArtifactKind = "research" | "plan" | "worker_output" | "review" | "delivery";
export type ReviewStatus = "passed" | "failed" | "needs_attention";
export type DeliveryStatus = "delivered" | "failed";
export type ConversationTransport = "web" | "cli" | "im" | "api";
export type MessageDeliveryDirection = "inbound" | "outbound";
export type MessageDeliveryStatus = "pending" | "delivered" | "failed" | "duplicate";
export type StewardMessageRole = "owner" | "steward" | "worker" | "system";
export type WorkerReportStatus = "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED";
export type GithubDeployKeyLeaseStatus = "active" | "released" | "stale";
export type GithubDeployKeyCleanupStatus = "not_requested" | "pending" | "completed" | "failed";

export interface AgentCommandProfile {
  commandTemplate: string;
}

export interface StewardProviderConfig {
  id: string;
  type: AgentProviderType;
  roles: AgentProviderRole[];
  commandProfiles: Record<string, AgentCommandProfile>;
  defaultCommandProfile: string;
  defaultModel: string | null;
  enabled: boolean;
}

export interface WorkerProviderConfig extends StewardProviderConfig {
  priority: number;
  tags: string[];
  supportsLocal: boolean;
  supportsRemote: boolean;
}

export interface AgentFleetConfig {
  version: 1;
  stewardProviderId: string;
  stewardProvider: StewardProviderConfig;
  workerProviders: WorkerProviderConfig[];
}

export interface Goal {
  id: string;
  projectName: string;
  workspacePath?: string;
  title: string;
  body: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StewardDecision {
  id: string;
  goalId: string;
  workerSessionId: string | null;
  title: string;
  rationale: string;
  risk: DecisionRisk;
  confidence: number;
  reversible: boolean;
  needsHumanReview: boolean;
  status: DecisionStatus;
  actionsJson: string;
  createdAt: string;
}

export interface WorkerSession {
  id: string;
  goalId: string;
  decisionId: string;
  kind: WorkerKind;
  providerId: string | null;
  providerType: AgentProviderType | null;
  model: string | null;
  command: string;
  cwd: string;
  pid: number | null;
  hostId: string | null;
  resumeId: string | null;
  status: WorkerSessionStatus;
  lastOutput: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerReport {
  id: string;
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
  createdAt: string;
}

export interface DecisionCorrection {
  id: string;
  decisionId: string;
  body: string;
  createdBy: "human" | "steward";
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  projectName: string | null;
  key: string;
  value: string;
  sourceCorrectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionNode {
  id: string;
  name: string;
  kind: "local" | "remote";
  status: "ready" | "offline" | "unknown";
  sshHost: string | null;
  workRoot: string;
  proxyUrl: string | null;
  tags: string[];
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface GithubDeployKeyLease {
  id: string;
  projectName: string;
  workspacePath: string;
  repositoryUrl: string;
  repositorySlug: string;
  githubDeployKeyId: string | null;
  publicKeyFingerprint: string;
  localPrivateKeyPath: string;
  remoteNodeId: string;
  remotePrivateKeyPath: string;
  activeWorkerSessionIds: string[];
  refcount: number;
  status: GithubDeployKeyLeaseStatus;
  cleanupStatus: GithubDeployKeyCleanupStatus;
  acquiredAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  updatedAt: string;
}

export interface WorktreeAssignment {
  id: string;
  workerSessionId: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  status: "planned" | "active" | "merged" | "abandoned";
  createdAt: string;
  updatedAt: string;
}

export interface StewardCheckpoint {
  id: string;
  reason: StewardCheckpointReason;
  summary: string;
  nextAction: string;
  goalIds: string[];
  workerSessionIds: string[];
  createdAt: string;
}

export interface ControlPlaneEvent {
  id: string;
  type: string;
  goalId: string | null;
  decisionId: string | null;
  workerSessionId: string | null;
  message: string;
  metadataJson: string;
  createdAt: string;
}

export interface AgentArtifact {
  id: string;
  goalId: string;
  role: AgentRole;
  kind: ArtifactKind;
  title: string;
  path: string;
  content: string;
  resourceId: string | null;
  createdAt: string;
}

export interface ReviewResult {
  id: string;
  goalId: string;
  reviewer: string;
  status: ReviewStatus;
  summary: string;
  artifactIds: string[];
  resourceId: string | null;
  createdAt: string;
}

export interface DeliveryReport {
  id: string;
  goalId: string;
  status: DeliveryStatus;
  markdown: string;
  artifactIds: string[];
  reviewResultIds: string[];
  resourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  transport: ConversationTransport;
  projectName: string | null;
  workspacePath: string | null;
  externalConversationId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationBinding {
  id: string;
  conversationId: string;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDelivery {
  id: string;
  conversationId: string;
  stewardMessageId: string | null;
  transport: ConversationTransport;
  direction: MessageDeliveryDirection;
  externalMessageId: string | null;
  idempotencyKey: string | null;
  deliveryStatus: MessageDeliveryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StewardMessage {
  id: string;
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
  createdAt: string;
}

export interface StewardConversation {
  id: string;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
  transport: ConversationTransport | null;
  title?: string | null;
  externalConversationId?: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
}

export interface RecoveryWorkerSession {
  id: string;
  goalId: string;
  decisionId: string;
  status: WorkerSessionStatus;
  command: string;
  cwd: string;
  pid: number | null;
  hostId: string | null;
  resumeId: string | null;
  resumeCommand: string | null;
  worktreeAssignmentId: string | null;
  repositoryPath: string | null;
  worktreePath: string | null;
  branchName: string | null;
  worktreeStatus: WorktreeAssignment["status"] | null;
  lastOutput: string;
  updatedAt: string;
}

export interface StewardRecoveryReport {
  generatedAt: string;
  lastCheckpoint: StewardCheckpoint | null;
  activeGoalIds: string[];
  activeGoals: Goal[];
  activeWorkerSessions: RecoveryWorkerSession[];
  recentWorkerReports: WorkerReport[];
  recentStewardMessages: StewardMessage[];
  nextActions: string[];
}

export interface DashboardData {
  goals: Goal[];
  decisions: StewardDecision[];
  workerSessions: WorkerSession[];
  corrections: DecisionCorrection[];
  memories: MemoryEntry[];
  executionNodes: ExecutionNode[];
  githubDeployKeyLeases: GithubDeployKeyLease[];
  worktreeAssignments: WorktreeAssignment[];
  stewardCheckpoints: StewardCheckpoint[];
  workerReports?: WorkerReport[];
  stewardMessages?: StewardMessage[];
  conversations?: Conversation[];
  conversationBindings?: ConversationBinding[];
  messageDeliveries?: MessageDelivery[];
  agentArtifacts: AgentArtifact[];
  reviews: ReviewResult[];
  deliveryReports: DeliveryReport[];
  events: ControlPlaneEvent[];
}
