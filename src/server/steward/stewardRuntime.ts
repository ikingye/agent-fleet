import { join, posix } from "node:path";
import type {
  Goal,
  DecisionCorrection,
  ExecutionNode,
  GithubDeployKeyLease,
  WorkerReport,
  WorkerReportStatus,
  WorkerSession
} from "../../shared/types.js";
import { GitRefSync, buildGitRefSyncRefs, type FetchInboundGitRefSyncInput, type GitRefSyncInboundResult } from "../remote/gitRefSync.js";
import type { GithubDeployKeyLeaseResolver } from "../remote/githubDeployKeyLeaseResolver.js";
import { evaluateRemoteNodeReadiness } from "../remote/remoteNodeReadiness.js";
import type { RemoteWorkspaceProvisioner, RemoteWorkspaceProvisionResult } from "../remote/remoteWorkspaceProvisioner.js";
import type { RemoteGithubDeployKeyProvisioner } from "../remote/remoteKeyProvisioner.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import {
  materializeWorktree,
  planWorktree,
  type MaterializeWorktreeRunner,
  type PlannedWorktree
} from "../worktrees/worktreeManager.js";
import type { WorkerAdapter } from "../workers/commandWorkerAdapter.js";
import { parseWorkerFinalReport } from "../workers/workerReportParser.js";
import { buildResumeCommand } from "../workers/resumeCommand.js";
import { buildMemoryContext, correctionMemoryKeys, type MemoryContext } from "./memoryContext.js";

export interface StewardRuntimeOptions {
  store: JsonControlPlaneStore;
  workerAdapter: WorkerAdapter;
  remoteWorkerAdapterFactory?: (node: ExecutionNode) => WorkerAdapter;
  remoteWorkspaceProvisioner?: RemoteWorkspaceProvisioner;
  githubDeployKeyLeaseResolver?: GithubDeployKeyLeaseResolver;
  remoteGithubDeployKeyProvisioner?: Pick<
    RemoteGithubDeployKeyProvisioner,
    "installRemoteKey" | "cleanupRemoteKey"
  >;
  githubDeployKeyLeaseTtlMs?: number;
  gitRefSync?: Pick<GitRefSync, "fetchInbound">;
  defaultWorkerCwd: string;
  defaultRepositoryPath?: string;
  worktreeRoot?: string;
  worktreeRunner?: MaterializeWorktreeRunner;
}

interface WorkerPlacement {
  adapter: WorkerAdapter;
  hostId: string | null;
  cwd: string;
  worktreePath: string;
  workerName: string;
  resourceTags: string[];
  remoteNodeName: string | null;
}

type InboundGitRefSyncTrigger = "worker-report" | "remote-provision";

const DEFAULT_GITHUB_DEPLOY_KEY_LEASE_TTL_MS = 6 * 60 * 60 * 1000;

interface RemoteDeployKeyDispatch {
  lease: GithubDeployKeyLease;
  gitSshCommand: string | null;
  sshHost: string;
}

type InboundGitRefSyncAudit =
  | {
      status: "skipped";
      reason: "missing-returned-ref";
    }
  | {
      status: GitRefSyncInboundResult["status"];
      trigger: InboundGitRefSyncTrigger;
      summary: string;
      actions: string[];
      repoRoot: string | null;
      originUrl: string | null;
      workerRef: string;
      returnedRef: string;
      returnedSha: string | null;
      expectedSha?: string;
    };

export interface AcceptGoalInput {
  projectName: string;
  workspacePath: string;
  title: string;
  body: string;
}

export interface CorrectDecisionInput {
  decisionId: string;
  body: string;
}

export class StewardRuntime {
  constructor(private readonly options: StewardRuntimeOptions) {}

  async acceptGoal(input: AcceptGoalInput): Promise<Goal> {
    const goal = await this.options.store.createGoal(input);
    const memoryContext = buildMemoryContext({
      goal,
      memories: (await this.options.store.dashboard()).memories
    });
    const repositoryPath = input.workspacePath;
    const worktreeRoot = this.options.worktreeRoot ?? join(repositoryPath, ".worktrees");
    let plannedWorktree: PlannedWorktree | null = null;
    const placement = await this.selectWorkerPlacement(goal, input.workspacePath);
    const decision = await this.options.store.recordDecision({
      goalId: goal.id,
      workerSessionId: null,
      title: "Start Worker Agent for goal",
      rationale: [
        "The goal is actionable and reversible enough for the Steward Agent to begin autonomous execution.",
        memoryContext.summary
      ]
        .filter((line): line is string => line !== null)
        .join(" "),
      risk: "medium",
      confidence: 0.72,
      reversible: true,
      needsHumanReview: true,
      status: "active",
      actions: [
        "Create an auditable Steward decision",
        `Worker Name: ${placement.workerName}`,
        ...buildMemoryActions(memoryContext),
        ...buildPlacementActions(placement),
        ...(placement.hostId === null ? [] : ["Provision remote scratch workspace before Worker launch"]),
        "Start a Worker Agent session",
        "Track resume metadata for recovery"
      ]
    });
    let workerCwd = placement.cwd;
    let remoteSession: WorkerSession | null = null;
    let remoteDeployKey: RemoteDeployKeyDispatch | null = null;

    if (placement.hostId === null && this.options.worktreeRunner !== undefined) {
      plannedWorktree = planWorktree({
        projectName: goal.projectName,
        repositoryPath,
        worktreeRoot,
        goalTitle: goal.title,
        workerSessionId: decision.id
      });
      await materializeWorktree(plannedWorktree, this.options.worktreeRunner);
      workerCwd = plannedWorktree.path;
    }

    if (placement.hostId !== null) {
      remoteSession = await this.options.store.createWorkerSession({
        goalId: goal.id,
        decisionId: decision.id,
        kind: placement.adapter.kind,
        command: "remote dispatch starting",
        cwd: placement.cwd,
        pid: null,
        hostId: placement.hostId,
        resumeId: null,
        status: "starting",
        lastOutput: "Remote dispatch selected; deploy-key lease and workspace provisioning pending."
      });
      await this.options.store.linkDecisionToWorkerSession(decision.id, remoteSession.id);

      const deployKeyPreparation = await this.prepareRemoteDeployKeyIfAvailable({
        goal,
        placement,
        session: remoteSession,
        workspacePath: input.workspacePath
      });

      if (deployKeyPreparation.status === "blocked") {
        await this.options.store.updateWorkerSessionLaunch({
          workerSessionId: remoteSession.id,
          command: "remote deploy key install",
          cwd: placement.cwd,
          pid: null,
          resumeId: null,
          status: "failed",
          lastOutput: deployKeyPreparation.summary
        });
        await this.releaseRemoteDeployKeyIfNeeded({
          deployKey: deployKeyPreparation.deployKey,
          workerSessionId: remoteSession.id
        });
        await this.options.store.createWorktreeAssignment({
          workerSessionId: remoteSession.id,
          repositoryPath,
          worktreePath: placement.worktreePath,
          branchName: remoteWorkerBranchName(placement.workerName)
        });
        const updatedGoal = await this.options.store.updateGoalStatus(goal.id, "blocked");
        await this.options.store.recordStewardCheckpoint({
          reason: "dispatch",
          summary: `Remote deploy-key provisioning blocked Worker launch for goal: ${goal.title}`,
          nextAction: deployKeyPreparation.summary,
          goalIds: [goal.id],
          workerSessionIds: [remoteSession.id]
        });

        return updatedGoal;
      }

      remoteDeployKey = deployKeyPreparation.deployKey;
    }

    const provisionResult = await this.provisionRemoteWorkspaceIfNeeded(
      placement,
      input.workspacePath,
      remoteDeployKey?.gitSshCommand ?? undefined
    );

    if (provisionResult?.status === "blocked") {
      const session =
        remoteSession ??
        (await this.options.store.createWorkerSession({
          goalId: goal.id,
          decisionId: decision.id,
          kind: placement.adapter.kind,
          command: "remote workspace provisioning",
          cwd: placement.cwd,
          pid: null,
          hostId: placement.hostId,
          resumeId: null,
          status: "failed",
          lastOutput: provisionResult.summary
        }));
      if (remoteSession !== null) {
        await this.options.store.updateWorkerSessionLaunch({
          workerSessionId: session.id,
          command: "remote workspace provisioning",
          cwd: placement.cwd,
          pid: null,
          resumeId: null,
          status: "failed",
          lastOutput: provisionResult.summary
        });
      }
      await this.releaseRemoteDeployKeyIfNeeded({
        deployKey: remoteDeployKey,
        workerSessionId: session.id
      });
      await this.options.store.createWorktreeAssignment({
        workerSessionId: session.id,
        repositoryPath,
        worktreePath: placement.worktreePath,
        branchName: remoteWorkerBranchName(placement.workerName)
      });
      if (remoteSession === null) {
        await this.options.store.linkDecisionToWorkerSession(decision.id, session.id);
      }
      const updatedGoal = await this.options.store.updateGoalStatus(goal.id, "blocked");
      await this.options.store.recordStewardCheckpoint({
        reason: "dispatch",
        summary: `Remote workspace provisioning blocked Worker launch for goal: ${goal.title}`,
        nextAction: provisionResult.summary,
        goalIds: [goal.id],
        workerSessionIds: [session.id]
      });

      return updatedGoal;
    }

    const workerResult = await placement.adapter.start({
      goalTitle: goal.title,
      cwd: workerCwd,
      prompt: this.buildWorkerPrompt(placement.workerName, goal.title, goal.body, memoryContext),
      ...(remoteDeployKey?.gitSshCommand === null || remoteDeployKey?.gitSshCommand === undefined
        ? {}
        : { env: { GIT_SSH_COMMAND: remoteDeployKey.gitSshCommand } })
    });
    const session =
      remoteSession === null
        ? await this.options.store.createWorkerSession({
            goalId: goal.id,
            decisionId: decision.id,
            kind: placement.adapter.kind,
            command: workerResult.command,
            cwd: workerResult.cwd,
            pid: workerResult.pid,
            hostId: placement.hostId,
            resumeId: workerResult.resumeId,
            status: workerResult.status,
            lastOutput: workerResult.initialOutput
          })
        : await this.options.store.updateWorkerSessionLaunch({
            workerSessionId: remoteSession.id,
            command: workerResult.command,
            cwd: workerResult.cwd,
            pid: workerResult.pid,
            resumeId: workerResult.resumeId,
            status: workerResult.status,
            lastOutput: workerResult.initialOutput
          });
    this.attachWorkerCompletionHandler({
      completion: workerResult.completion,
      goalId: goal.id,
      goalTitle: goal.title,
      workerSessionId: session.id,
      workerName: placement.workerName,
      workspacePath: input.workspacePath,
      provisionResult,
      deployKey: remoteDeployKey
    });

    const worktreeAssignment =
      plannedWorktree ??
      (placement.hostId === null
        ? planWorktree({
            projectName: goal.projectName,
            repositoryPath,
            worktreeRoot,
            goalTitle: goal.title,
            workerSessionId: session.id
          })
        : {
            path: placement.worktreePath,
            branchName: remoteWorkerBranchName(placement.workerName)
          });
    await this.options.store.createWorktreeAssignment({
      workerSessionId: session.id,
      repositoryPath,
      worktreePath: worktreeAssignment.path,
      branchName: worktreeAssignment.branchName
    });

    if (remoteSession === null) {
      await this.options.store.linkDecisionToWorkerSession(decision.id, session.id);
    }

    const updatedGoal = await this.options.store.updateGoalStatus(goal.id, goalStatusForWorkerStatus(workerResult.status));
    await this.options.store.recordStewardCheckpoint({
      reason: "dispatch",
      summary: `Worker ${placement.workerName} recorded as session ${session.id} for goal: ${goal.title}`,
      nextAction: buildDispatchNextAction(
        session.id,
        placement.workerName,
        session.kind,
        workerResult.command,
        workerResult.resumeId,
        workerResult.status,
        workerResult.initialOutput,
        provisionResult,
        memoryContext
      ),
      goalIds: [goal.id],
      workerSessionIds: [session.id]
    });
    if (workerResult.status !== "running") {
      await this.releaseRemoteDeployKeyIfNeeded({
        deployKey: remoteDeployKey,
        workerSessionId: session.id
      });
    }

    return updatedGoal;
  }

  private async selectWorkerPlacement(goal: Goal, workspacePath: string): Promise<WorkerPlacement> {
    const resourceTags = detectGoalResourceTags(goal);
    const remoteNode = resourceTags.length === 0 ? null : await this.selectReadyRemoteNode(resourceTags);

    if (remoteNode !== null && this.options.remoteWorkerAdapterFactory !== undefined) {
      const remoteWorkspacePath = buildRemoteWorkspacePath(remoteNode, goal.projectName, workspacePath);

      return {
        adapter: this.options.remoteWorkerAdapterFactory(remoteNode),
        hostId: remoteNode.id,
        cwd: remoteWorkspacePath,
        worktreePath: remoteWorkspacePath,
        workerName: buildWorkerName(goal, true),
        resourceTags,
        remoteNodeName: remoteNode.name
      };
    }

    return {
      adapter: this.options.workerAdapter,
      hostId: null,
      cwd: workspacePath,
      worktreePath: workspacePath,
      workerName: buildWorkerName(goal, false),
      resourceTags,
      remoteNodeName: null
    };
  }

  private async selectReadyRemoteNode(requiredTags: string[]): Promise<ExecutionNode | null> {
    const dashboard = await this.options.store.dashboard();
    const runningByHostId = new Map<string, number>();

    for (const session of dashboard.workerSessions) {
      if (session.hostId === null || (session.status !== "starting" && session.status !== "running")) {
        continue;
      }

      runningByHostId.set(session.hostId, (runningByHostId.get(session.hostId) ?? 0) + 1);
    }

    const candidates = dashboard.executionNodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => {
        if (node.kind !== "remote") {
          return false;
        }

        return evaluateRemoteNodeReadiness({
          status: node.status,
          sshHost: node.sshHost,
          workRoot: node.workRoot,
          proxyUrl: node.proxyUrl,
          proxyRequired: false
        }).ready;
      })
      .map(({ node, index }) => {
        const capacity = Math.max(1, Math.floor(node.capacity));
        const running = runningByHostId.get(node.id) ?? 0;
        const availableSlots = capacity - running;
        const tagSet = new Set(node.tags.map((tag) => tag.toLowerCase()));
        const matchedRequiredTags = requiredTags.filter((tag) => tagSet.has(tag)).length;

        return { node, index, availableSlots, matchedRequiredTags };
      })
      .filter((candidate) => candidate.availableSlots > 0 && candidate.matchedRequiredTags === requiredTags.length);

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftMatchesAll = left.matchedRequiredTags === requiredTags.length ? 1 : 0;
      const rightMatchesAll = right.matchedRequiredTags === requiredTags.length ? 1 : 0;

      return (
        rightMatchesAll - leftMatchesAll ||
        right.matchedRequiredTags - left.matchedRequiredTags ||
        right.availableSlots - left.availableSlots ||
        left.index - right.index
      );
    });

    return candidates[0].node;
  }

  private async provisionRemoteWorkspaceIfNeeded(
    placement: WorkerPlacement,
    workspacePath: string,
    gitSshCommand?: string
  ): Promise<RemoteWorkspaceProvisionResult | null> {
    if (placement.hostId === null || this.options.remoteWorkspaceProvisioner === undefined) {
      return null;
    }

    const dashboard = await this.options.store.dashboard();
    const node = dashboard.executionNodes.find((item) => item.id === placement.hostId);

    if (node === undefined) {
      return {
        status: "blocked",
        summary: `Remote workspace blocked: selected execution node ${placement.hostId} is no longer registered.`,
        actions: ["Skipped Worker launch because selected remote node was missing"]
      };
    }

    return this.options.remoteWorkspaceProvisioner.provision({
      node,
      localWorkspacePath: workspacePath,
      remoteWorkspacePath: placement.cwd,
      workerName: placement.workerName,
      ...(gitSshCommand === undefined ? {} : { gitSshCommand })
    });
  }

  private async prepareRemoteDeployKeyIfAvailable(input: {
    goal: Goal;
    placement: WorkerPlacement;
    session: WorkerSession;
    workspacePath: string;
  }): Promise<
    | { status: "skipped"; deployKey: null }
    | { status: "prepared"; deployKey: RemoteDeployKeyDispatch }
    | { status: "blocked"; summary: string; actions: string[]; deployKey: RemoteDeployKeyDispatch | null }
  > {
    if (
      input.placement.hostId === null ||
      this.options.githubDeployKeyLeaseResolver === undefined ||
      this.options.remoteGithubDeployKeyProvisioner === undefined
    ) {
      return { status: "skipped", deployKey: null };
    }

    const dashboard = await this.options.store.dashboard();
    const node = dashboard.executionNodes.find((item) => item.id === input.placement.hostId);

    if (node === undefined) {
      return {
        status: "blocked",
        summary: `Remote deploy key blocked: selected execution node ${input.placement.hostId} is no longer registered.`,
        actions: ["Skipped deploy-key provisioning because selected remote node was missing"],
        deployKey: null
      };
    }

    const sshHost = node.sshHost?.trim();
    if (sshHost === undefined || sshHost === "") {
      return {
        status: "blocked",
        summary: "Remote deploy key blocked: selected remote node has no SSH host.",
        actions: ["Skipped deploy-key provisioning because sshHost is missing"],
        deployKey: null
      };
    }

    const config = await this.options.githubDeployKeyLeaseResolver.resolve({
      projectName: input.goal.projectName,
      workspacePath: input.workspacePath,
      node
    });

    if (config === null) {
      return { status: "skipped", deployKey: null };
    }

    const lease = await this.options.store.acquireGithubDeployKeyLease({
      projectName: input.goal.projectName,
      workspacePath: input.workspacePath,
      repositoryUrl: config.repositoryUrl,
      repositorySlug: config.repositorySlug,
      githubDeployKeyId: config.githubDeployKeyId,
      publicKeyFingerprint: config.publicKeyFingerprint,
      localPrivateKeyPath: config.localPrivateKeyPath,
      remoteNodeId: node.id,
      remotePrivateKeyPath: config.remotePrivateKeyPath,
      workerSessionId: input.session.id,
      expiresAt: new Date(
        Date.now() + (this.options.githubDeployKeyLeaseTtlMs ?? DEFAULT_GITHUB_DEPLOY_KEY_LEASE_TTL_MS)
      ).toISOString()
    });
    const install = await this.options.remoteGithubDeployKeyProvisioner.installRemoteKey({ lease, sshHost });
    const deployKey = {
      lease,
      gitSshCommand: install.gitSshCommand,
      sshHost
    };

    if (install.status === "blocked" || deployKey.gitSshCommand === null) {
      return {
        status: "blocked",
        summary: install.summary,
        actions: install.actions,
        deployKey
      };
    }

    return {
      status: "prepared",
      deployKey
    };
  }

  private async releaseRemoteDeployKeyIfNeeded(input: {
    deployKey: RemoteDeployKeyDispatch | null;
    workerSessionId: string;
  }): Promise<void> {
    if (input.deployKey === null || this.options.remoteGithubDeployKeyProvisioner === undefined) {
      return;
    }

    const releasedLease = await this.options.store.releaseGithubDeployKeyLease({
      leaseId: input.deployKey.lease.id,
      workerSessionId: input.workerSessionId
    });

    if (releasedLease.status === "active" || releasedLease.refcount > 0 || releasedLease.cleanupStatus !== "pending") {
      return;
    }

    const cleanup = await this.options.remoteGithubDeployKeyProvisioner.cleanupRemoteKey({
      lease: releasedLease,
      sshHost: input.deployKey.sshHost
    });
    await this.options.store.updateGithubDeployKeyLeaseCleanup({
      leaseId: releasedLease.id,
      cleanupStatus: cleanup.cleanupStatus
    });
  }

  async correctDecision(input: CorrectDecisionInput): Promise<DecisionCorrection> {
    const correction = await this.options.store.addCorrection({
      decisionId: input.decisionId,
      body: input.body,
      createdBy: "human"
    });

    for (const key of correctionMemoryKeys(input.body)) {
      await this.options.store.upsertMemory({
        scope: "user",
        projectName: null,
        key,
        value: input.body,
        sourceCorrectionId: correction.id
      });
    }

    const dashboard = await this.options.store.dashboard();
    const correctedDecision = dashboard.decisions.find((decision) => decision.id === input.decisionId);

    if (correctedDecision !== undefined) {
      await this.options.store.recordDecision({
        goalId: correctedDecision.goalId,
        workerSessionId: correctedDecision.workerSessionId,
        title: "Apply human correction",
        rationale: `The human corrected a Steward decision: ${input.body}`,
        risk: "low",
        confidence: 0.9,
        reversible: true,
        needsHumanReview: false,
        status: "active",
        actions: ["Update memory", "Use the correction in future Worker instructions"]
      });
      await this.options.store.recordStewardCheckpoint({
        reason: "correction",
        summary: "Human correction recorded for Steward decision.",
        nextAction: "Use the correction in future Worker instructions and recovery summaries.",
        goalIds: [correctedDecision.goalId],
        workerSessionIds: correctedDecision.workerSessionId === null ? [] : [correctedDecision.workerSessionId]
      });
    }

    return correction;
  }

  private buildWorkerPrompt(workerName: string, title: string, body: string, memoryContext: MemoryContext): string {
    return [
      `Worker Name: ${workerName}`,
      "",
      "You are a Worker Agent operating under the Steward Agent.",
      "Treat Steward instructions as the human owner's instructions.",
      "Use the exact Worker Name as the heading of your final report.",
      "",
      ...memoryContext.promptLines,
      ...(memoryContext.promptLines.length === 0 ? [] : [""]),
      `Goal: ${title}`,
      "",
      body,
      "",
      "Report blockers, resume ids, test results, and important decisions back to the Steward Agent."
    ].join("\n");
  }

  private attachWorkerCompletionHandler(input: {
    completion: Awaited<ReturnType<WorkerAdapter["start"]>>["completion"];
    goalId: string;
    goalTitle: string;
    workerName: string;
    workerSessionId: string;
    workspacePath: string;
    provisionResult: RemoteWorkspaceProvisionResult | null;
    deployKey: RemoteDeployKeyDispatch | null;
  }): void {
    if (input.completion === undefined) {
      return;
    }

    void input.completion
      .then(async (completion) => {
        try {
          const parsedReport = parseWorkerFinalReport(completion.output, { expectedWorkerName: input.workerName });
          await this.options.store.updateWorkerSessionStatus({
            workerSessionId: input.workerSessionId,
            status: completion.status,
            lastOutput: completion.output
          });
          const workerReport =
            parsedReport === null
              ? null
              : await this.options.store.recordWorkerReport({
                  goalId: input.goalId,
                  workerSessionId: input.workerSessionId,
                  ...parsedReport
                });
          const inboundGitRefSync = await this.fetchInboundGitRefIfNeeded({
            workerReport,
            workerName: input.workerName,
            workspacePath: input.workspacePath,
            provisionResult: input.provisionResult
          });
          await this.options.store.updateGoalStatus(
            input.goalId,
            inboundGitRefSync.status === "blocked"
              ? "blocked"
              : goalStatusForWorkerOutcome(completion.status, workerReport?.status ?? null)
          );
          if (inboundGitRefSync.status === "fetched") {
            await this.options.store.recordDecision({
              goalId: input.goalId,
              workerSessionId: input.workerSessionId,
              title: "Queue review/merge handoff",
              rationale:
                "The Worker returned a git ref and the Steward fetched it locally; owner-facing review is needed before any merge.",
              risk: "medium",
              confidence: 0.78,
              reversible: true,
              needsHumanReview: true,
              status: "active",
              actions: [
                `Review returned branch for Worker ${input.workerName}`,
                `Returned ref: ${inboundGitRefSync.returnedRef}`,
                "Decide whether to merge; do not merge automatically"
              ]
            });
          }
          await this.options.store.recordStewardCheckpoint({
            reason: "recovery",
            summary:
              workerReport === null
                ? `Worker session ${input.workerSessionId} ${completion.status} for goal: ${input.goalTitle}`
                : `Worker session ${input.workerSessionId} reported ${workerReport.status} for goal: ${input.goalTitle}`,
            nextAction:
              appendInboundGitRefSyncNextAction(
                workerReport === null
                  ? buildCompletionNextAction(input.workerSessionId, completion.status, completion.output)
                  : buildReportCompletionNextAction(input.workerSessionId, workerReport),
                inboundGitRefSync
              ),
            goalIds: [input.goalId],
            workerSessionIds: [input.workerSessionId],
            metadata: {
              inboundGitRefSync
            }
          });
        } finally {
          await this.releaseRemoteDeployKeyIfNeeded({
            deployKey: input.deployKey,
            workerSessionId: input.workerSessionId
          });
        }
      })
      .catch((error: unknown) => {
        console.error("Worker completion handler failed", error);
      });
  }

  private async fetchInboundGitRefIfNeeded(input: {
    workerReport: WorkerReport | null;
    workerName: string;
    workspacePath: string;
    provisionResult: RemoteWorkspaceProvisionResult | null;
  }): Promise<InboundGitRefSyncAudit> {
    const trigger = buildInboundGitRefSyncTrigger(input.workerReport, input.provisionResult);

    if (trigger === null) {
      return {
        status: "skipped",
        reason: "missing-returned-ref"
      };
    }

    const gitRefSync = this.options.gitRefSync ?? new GitRefSync();
    const syncInput: FetchInboundGitRefSyncInput = {
      workspacePath: input.workspacePath,
      workerName: input.workerName,
      ...(trigger.expectedSha === undefined ? {} : { expectedSha: trigger.expectedSha })
    };

    try {
      const result = await gitRefSync.fetchInbound(syncInput);

      return {
        status: result.status,
        trigger: trigger.trigger,
        summary: result.summary,
        actions: result.actions,
        repoRoot: result.repoRoot,
        originUrl: result.originUrl,
        workerRef: result.workerRef,
        returnedRef: trigger.returnedRef ?? result.returnedRef,
        returnedSha: result.returnedSha,
        ...(trigger.expectedSha === undefined ? {} : { expectedSha: trigger.expectedSha })
      };
    } catch (error: unknown) {
      const refs = buildGitRefSyncRefs(input.workerName);

      return {
        status: "blocked",
        trigger: trigger.trigger,
        summary: `Returned git-ref sync blocked: ${error instanceof Error ? error.message : String(error)}`,
        actions: ["Inbound git-ref sync threw before returning a result."],
        repoRoot: null,
        originUrl: null,
        workerRef: refs.workerRef,
        returnedRef: trigger.returnedRef ?? refs.returnedRef,
        returnedSha: null,
        ...(trigger.expectedSha === undefined ? {} : { expectedSha: trigger.expectedSha })
      };
    }
  }
}

function buildRemoteWorkspacePath(node: ExecutionNode, projectName: string, workspacePath: string): string {
  return posix.join(node.workRoot, slugify(projectName), slugify(workspaceName(workspacePath)));
}

function remoteWorkerBranchName(workerName: string): string {
  return buildGitRefSyncRefs(workerName).workerBranch;
}

function detectGoalResourceTags(goal: Goal): string[] {
  const text = `${goal.title}\n${goal.body}`.toLowerCase();
  const tags = new Set<string>();

  if (/(gpu|cuda|训练|模型|推理|渲染)/i.test(text)) {
    tags.add("gpu");
  }

  if (/(long-running|overnight|持续|长时间|跑一晚|高cpu|cpu|heavy|high-load|高负载|并行|批量|build|test)/i.test(text)) {
    tags.add("high-cpu");
  }

  return [...tags];
}

function buildPlacementActions(placement: WorkerPlacement): string[] {
  if (placement.hostId !== null) {
    return [
      `Dispatch to remote execution node ${placement.remoteNodeName ?? placement.hostId} for ${placement.resourceTags.join(", ")} work`
    ];
  }

  if (placement.resourceTags.length > 0) {
    return ["Use local Worker fallback; no ready remote capacity is available."];
  }

  return ["Use local Worker adapter; goal does not require remote offload."];
}

function buildMemoryActions(memoryContext: MemoryContext): string[] {
  if (memoryContext.entries.length === 0) {
    return [];
  }

  return [
    `Apply ${memoryContext.entries.length} relevant owner ${
      memoryContext.entries.length === 1 ? "memory" : "memories"
    } to Worker instructions`
  ];
}

function buildWorkerName(goal: Goal, remote: boolean): string {
  const timestamp = formatWorkerTimestamp(new Date());
  const remoteMarker = remote ? "-remote" : "";

  return `${slugify(goal.projectName)}-${slugify(goal.title)}${remoteMarker}-${timestamp}`;
}

function formatWorkerTimestamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ];
  const [year, month, day, hour, minute] = parts.map((part, index) =>
    index === 0 ? String(part) : String(part).padStart(2, "0")
  );

  return `${year}${month}${day}${hour}${minute}`;
}

function workspaceName(workspacePath: string): string {
  const normalized = workspacePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  const segments = normalized.split("/").filter((segment) => segment.trim() !== "");

  return segments.at(-1) ?? "workspace";
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, "-")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug === "" ? "workspace" : slug;
}

function goalStatusForWorkerStatus(status: "running" | "completed" | "failed") {
  if (status === "running") {
    return "running";
  }

  return status === "completed" ? "completed" : "blocked";
}

function goalStatusForWorkerOutcome(status: "completed" | "failed", reportStatus: WorkerReportStatus | null) {
  if (status === "failed" || reportStatus === "BLOCKED") {
    return "blocked";
  }

  return "completed";
}

function buildDispatchNextAction(
  workerSessionId: string,
  workerName: string,
  kind: WorkerAdapter["kind"],
  command: string,
  resumeId: string | null,
  status: "running" | "completed" | "failed",
  initialOutput: string,
  provisionResult: RemoteWorkspaceProvisionResult | null,
  memoryContext: MemoryContext
): string {
  if (status === "failed") {
    const output = summarizeWorkerOutput(initialOutput);

    if (output === "") {
      return appendMemorySummary(
        `Review failed Worker session ${workerSessionId} (${workerName}); ${command} did not start.`,
        memoryContext
      );
    }

    return appendMemorySummary(`Review failed Worker session ${workerSessionId} (${workerName}); ${output}`, memoryContext);
  }

  const resumeCommand = buildResumeCommand({
    kind,
    baseCommand: command,
    resumeId
  });

  if (resumeCommand === null) {
    return appendProvisionSummary(
      appendMemorySummary(
        `Monitor Worker session ${workerSessionId}; no resume id is available yet, so recover from durable state if the Steward session is interrupted. Worker Name: ${workerName}.`,
        memoryContext
      ),
      provisionResult
    );
  }

  return appendProvisionSummary(
    appendMemorySummary(
      `Monitor Worker session ${workerSessionId}; resume with ${resumeCommand} if the Steward session is interrupted. Worker Name: ${workerName}.`,
      memoryContext
    ),
    provisionResult
  );
}

function appendMemorySummary(nextAction: string, memoryContext: MemoryContext): string {
  if (memoryContext.entries.length === 0) {
    return nextAction;
  }

  return `${nextAction} Memory applied: ${memoryContext.entries.length} relevant owner ${
    memoryContext.entries.length === 1 ? "preference" : "preferences"
  }.`;
}

function appendProvisionSummary(nextAction: string, provisionResult: RemoteWorkspaceProvisionResult | null): string {
  if (provisionResult === null) {
    return nextAction;
  }

  return `${nextAction} Remote workspace provisioning: ${provisionResult.summary}`;
}

function buildInboundGitRefSyncTrigger(
  workerReport: WorkerReport | null,
  provisionResult: RemoteWorkspaceProvisionResult | null
): { trigger: InboundGitRefSyncTrigger; returnedRef: string | null; expectedSha?: string } | null {
  const returnedRef = normalizeOptionalString(workerReport?.returnedRef);
  const returnedSha = normalizeOptionalString(workerReport?.returnedSha);

  if (returnedRef !== null || returnedSha !== null) {
    return {
      trigger: "worker-report",
      returnedRef,
      ...(returnedSha === null ? {} : { expectedSha: returnedSha })
    };
  }

  if (provisionResult?.gitRefSync?.workerRef !== undefined) {
    return {
      trigger: "remote-provision",
      returnedRef: provisionResult.gitRefSync.returnedRef
    };
  }

  return null;
}

function appendInboundGitRefSyncNextAction(nextAction: string, audit: InboundGitRefSyncAudit): string {
  if (audit.status === "skipped") {
    return `${nextAction} Returned git-ref sync skipped: no returned ref/SHA or remote Worker ref was advertised.`;
  }

  if (audit.status === "blocked") {
    return `${nextAction} ${audit.summary} Owner review required.`;
  }

  return `${nextAction} ${audit.summary} Review/merge handoff queued; inspect the returned branch and decide whether to merge.`;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function summarizeWorkerOutput(output: string): string {
  const oneLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");

  return oneLine.length > 240 ? `${oneLine.slice(0, 237)}...` : oneLine;
}

function buildCompletionNextAction(
  workerSessionId: string,
  status: "completed" | "failed",
  output: string
): string {
  const summary = summarizeWorkerOutput(output);

  if (status === "completed") {
    return summary === ""
      ? `Review completed Worker session ${workerSessionId} and decide the next owner-facing step.`
      : `Review completed Worker session ${workerSessionId}: ${summary}`;
  }

  return summary === ""
    ? `Review failed Worker session ${workerSessionId} and decide whether to resume, correct, or ask the owner.`
    : `Review failed Worker session ${workerSessionId}: ${summary}`;
}

function buildReportCompletionNextAction(workerSessionId: string, report: WorkerReport): string {
  const pieces = [`Worker report ${report.id} for session ${workerSessionId} is ${report.status}.`];

  if (report.nextActions.length > 0) {
    pieces.push(`Next action: ${report.nextActions.join(" ")}`);
  } else if (report.status === "BLOCKED") {
    pieces.push("Decide whether to resume, correct, or ask the owner.");
  } else {
    pieces.push("Review the structured Worker report and decide the next owner-facing step.");
  }

  if (report.blockers.length > 0) {
    pieces.push(`Blockers: ${report.blockers.join(" ")}`);
  }

  if (report.verification.length > 0) {
    pieces.push(`Verification: ${report.verification.join(" ")}`);
  }

  if (report.needsOwnerReview) {
    pieces.push("Owner review required.");
  }

  if (report.resumeId !== null) {
    pieces.push(`Resume id: ${report.resumeId}.`);
  }

  return pieces.join(" ");
}
