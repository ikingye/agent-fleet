import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ControlPlaneEvent,
  DashboardData,
  DecisionCorrection,
  DecisionRisk,
  DecisionStatus,
  ExecutionNode,
  Goal,
  GoalStatus,
  MemoryEntry,
  MemoryScope,
  StewardDecision,
  WorkerKind,
  WorktreeAssignment,
  WorkerSession,
  WorkerSessionStatus
} from "../../shared/types.js";

interface ControlPlaneState extends DashboardData {
  version: 1;
}

export interface CreateGoalInput {
  projectName: string;
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

export interface CreateWorktreeAssignmentInput {
  workerSessionId: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
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
    events: []
  };
}

function parseState(raw: string): ControlPlaneState {
  const parsed = JSON.parse(raw) as Partial<ControlPlaneState>;

  return {
    version: 1,
    goals: parsed.goals ?? [],
    decisions: parsed.decisions ?? [],
    workerSessions: parsed.workerSessions ?? [],
    corrections: parsed.corrections ?? [],
    memories: parsed.memories ?? [],
    executionNodes: parsed.executionNodes ?? [],
    worktreeAssignments: parsed.worktreeAssignments ?? [],
    events: parsed.events ?? []
  };
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
      events: [...this.state.events]
    };
  }

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const timestamp = now();
    const goal: Goal = {
      id: randomUUID(),
      projectName: input.projectName,
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
    this.addEvent({
      type: "worker.started",
      goalId: session.goalId,
      decisionId: session.decisionId,
      workerSessionId: session.id,
      message: `${session.kind} Worker Agent started`,
      metadata: {
        command: session.command,
        cwd: session.cwd,
        pid: session.pid,
        resumeId: session.resumeId
      }
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

  private findGoal(goalId: string): Goal {
    const goal = this.state.goals.find((item) => item.id === goalId);
    if (goal === undefined) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    return goal;
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
