import type {
  DashboardData,
  DecisionCorrection,
  ExecutionNode,
  GithubDeployKeyLease,
  GithubDeployKeyLeaseStatus,
  Goal,
  StewardMessage,
  WorkerReport
} from "../shared/types.js";

export type { StewardMessage };

export interface ClientGoal extends Goal {
  workspacePath?: string;
}

export interface ClientExecutionNode extends ExecutionNode {
  lastHighLevelNote?: string | null;
  lastNote?: string | null;
  note?: string | null;
}

export interface ClientDashboardData extends Omit<DashboardData, "executionNodes" | "goals" | "workerReports"> {
  executionNodes: ClientExecutionNode[];
  goals: ClientGoal[];
  workerReports: WorkerReport[];
  stewardMessages: StewardMessage[];
}

const emptyDashboard: ClientDashboardData = {
  goals: [],
  decisions: [],
  workerSessions: [],
  corrections: [],
  memories: [],
  executionNodes: [],
  githubDeployKeyLeases: [],
  worktreeAssignments: [],
  stewardCheckpoints: [],
  workerReports: [],
  agentArtifacts: [],
  reviews: [],
  deliveryReports: [],
  stewardMessages: [],
  events: []
};

export interface CreateGoalPayload {
  projectName: string;
  workspacePath: string;
  title: string;
  body: string;
}

export interface SendStewardMessagePayload {
  body: string;
  projectName?: string;
  workspacePath?: string;
  goalId?: string;
}

export interface SendStewardMessageResponse {
  ownerMessage: StewardMessage;
  stewardMessage: StewardMessage;
}

export interface ClientConversation {
  id: string;
  title?: string | null;
  projectName?: string | null;
  workspacePath?: string | null;
  goalId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ListConversationsResponse {
  conversations?: ClientConversation[];
}

export interface ConversationMessagesResponse {
  messages?: StewardMessage[];
}

export type RegisterExecutionNodePayload = Omit<ExecutionNode, "id" | "createdAt" | "updatedAt">;

export interface AcquireGithubDeployKeyLeasePayload {
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

export interface RenewGithubDeployKeyLeasePayload {
  workerSessionId: string;
  expiresAt: string;
  now?: string;
}

export interface ReleaseGithubDeployKeyLeasePayload {
  workerSessionId: string;
  now?: string;
}

export interface ExpireGithubDeployKeyLeasesPayload {
  now?: string;
}

export interface ListGithubDeployKeyLeasesFilters {
  projectName?: string;
  workspacePath?: string;
  repositoryUrl?: string;
  repositorySlug?: string;
  remoteNodeId?: string;
  status?: GithubDeployKeyLeaseStatus;
}

export interface GithubDeployKeyLeaseResponse {
  lease: GithubDeployKeyLease;
}

export interface ListGithubDeployKeyLeasesResponse {
  leases: GithubDeployKeyLease[];
}

export interface ExpireGithubDeployKeyLeasesResponse {
  expiredLeaseIds: string[];
}

export async function fetchDashboard(): Promise<ClientDashboardData> {
  const response = await fetch("/api/dashboard");

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard.");
  }

  const data = (await response.json()) as Partial<ClientDashboardData>;

  return {
    ...emptyDashboard,
    ...data,
    goals: data.goals ?? [],
    decisions: data.decisions ?? [],
    workerSessions: data.workerSessions ?? [],
    corrections: data.corrections ?? [],
    memories: data.memories ?? [],
    executionNodes: data.executionNodes ?? [],
    githubDeployKeyLeases: data.githubDeployKeyLeases ?? [],
    worktreeAssignments: data.worktreeAssignments ?? [],
    stewardCheckpoints: data.stewardCheckpoints ?? [],
    workerReports: data.workerReports ?? [],
    agentArtifacts: data.agentArtifacts ?? [],
    reviews: data.reviews ?? [],
    deliveryReports: data.deliveryReports ?? [],
    stewardMessages: data.stewardMessages ?? [],
    events: data.events ?? []
  };
}

export async function createGoal(payload: CreateGoalPayload): Promise<Goal> {
  const response = await fetch("/api/goals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to create goal.");
  }

  return response.json() as Promise<Goal>;
}

export async function sendStewardMessage(payload: SendStewardMessagePayload): Promise<SendStewardMessageResponse> {
  return sendStewardMessageViaLegacyEndpoint(payload);
}

function isCompatibilityFallback(response: Response): boolean {
  return response.status === 404 || response.status === 405;
}

export async function fetchConversations(): Promise<ClientConversation[] | null> {
  const response = await fetch("/api/conversations", {
    method: "GET"
  });

  if (isCompatibilityFallback(response)) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to fetch conversations.");
  }

  const data = (await response.json()) as ListConversationsResponse;

  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function fetchConversationMessages(conversationId: string): Promise<StewardMessage[] | null> {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "GET"
  });

  if (isCompatibilityFallback(response)) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to fetch conversation messages.");
  }

  const data = (await response.json()) as ConversationMessagesResponse;

  return Array.isArray(data.messages) ? data.messages : [];
}

export async function sendConversationMessage(
  conversationId: string,
  payload: SendStewardMessagePayload
): Promise<SendStewardMessageResponse | null> {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (isCompatibilityFallback(response)) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to send conversation message.");
  }

  return response.json() as Promise<SendStewardMessageResponse>;
}

export async function sendStewardConversationMessage(
  payload: SendStewardMessagePayload,
  conversationId?: string | null
): Promise<SendStewardMessageResponse> {
  if (conversationId !== undefined && conversationId !== null && conversationId !== "") {
    const conversationResponse = await sendConversationMessage(conversationId, payload);

    if (conversationResponse !== null) {
      return conversationResponse;
    }
  }

  return sendStewardMessageViaLegacyEndpoint(payload);
}

async function sendStewardMessageViaLegacyEndpoint(
  payload: SendStewardMessagePayload
): Promise<SendStewardMessageResponse> {
  const response = await fetch("/api/steward/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to send Steward message.");
  }

  return response.json() as Promise<SendStewardMessageResponse>;
}

export async function correctDecision(decisionId: string, body: string): Promise<DecisionCorrection> {
  const response = await fetch(`/api/decisions/${decisionId}/corrections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body })
  });

  if (!response.ok) {
    throw new Error("Failed to send correction.");
  }

  return response.json() as Promise<DecisionCorrection>;
}

export async function registerExecutionNode(payload: RegisterExecutionNodePayload): Promise<ExecutionNode> {
  const response = await fetch("/api/execution-nodes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to register execution node.");
  }

  return response.json() as Promise<ExecutionNode>;
}

export async function listGithubDeployKeyLeases(
  filters: ListGithubDeployKeyLeasesFilters = {}
): Promise<GithubDeployKeyLease[]> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      query.set(key, value);
    }
  }

  const response = await fetch(`/api/github-deploy-key-leases${query.size > 0 ? `?${query.toString()}` : ""}`);

  if (!response.ok) {
    throw new Error("Failed to fetch GitHub deploy-key leases.");
  }

  const data = (await response.json()) as ListGithubDeployKeyLeasesResponse;

  return data.leases;
}

export async function acquireGithubDeployKeyLease(
  payload: AcquireGithubDeployKeyLeasePayload
): Promise<GithubDeployKeyLease> {
  const response = await fetch("/api/github-deploy-key-leases/acquire", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to acquire GitHub deploy-key lease.");
  }

  const data = (await response.json()) as GithubDeployKeyLeaseResponse;

  return data.lease;
}

export async function renewGithubDeployKeyLease(
  leaseId: string,
  payload: RenewGithubDeployKeyLeasePayload
): Promise<GithubDeployKeyLease> {
  const response = await fetch(`/api/github-deploy-key-leases/${leaseId}/renew`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to renew GitHub deploy-key lease.");
  }

  const data = (await response.json()) as GithubDeployKeyLeaseResponse;

  return data.lease;
}

export async function releaseGithubDeployKeyLease(
  leaseId: string,
  payload: ReleaseGithubDeployKeyLeasePayload
): Promise<GithubDeployKeyLease> {
  const response = await fetch(`/api/github-deploy-key-leases/${leaseId}/release`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to release GitHub deploy-key lease.");
  }

  const data = (await response.json()) as GithubDeployKeyLeaseResponse;

  return data.lease;
}

export async function expireGithubDeployKeyLeases(
  payload: ExpireGithubDeployKeyLeasesPayload = {}
): Promise<ExpireGithubDeployKeyLeasesResponse> {
  const response = await fetch("/api/github-deploy-key-leases/expire", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to expire GitHub deploy-key leases.");
  }

  return response.json() as Promise<ExpireGithubDeployKeyLeasesResponse>;
}

async function postOwnerAction(path: string, failureMessage: string): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(failureMessage);
  }

  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function runAutonomyTick(): Promise<unknown> {
  return postOwnerAction("/api/steward/autonomy/run", "Failed to run autonomy tick.");
}

export async function reconcileRecovery(): Promise<unknown> {
  return postOwnerAction("/api/recovery/reconcile", "Failed to reconcile recovery.");
}
