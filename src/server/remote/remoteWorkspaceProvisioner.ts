import type { ExecutionNode } from "../../shared/types.js";
import { GitRefSync } from "./gitRefSync.js";

export interface RemoteWorkspaceProvisionInput {
  node: ExecutionNode;
  localWorkspacePath: string;
  remoteWorkspacePath: string;
  workerName: string;
}

export interface RemoteWorkspaceProvisionResult {
  status: "prepared" | "blocked";
  summary: string;
  actions: string[];
}

export interface RemoteWorkspaceProvisioner {
  provision(input: RemoteWorkspaceProvisionInput): Promise<RemoteWorkspaceProvisionResult>;
}

export class GitRemoteWorkspaceProvisioner implements RemoteWorkspaceProvisioner {
  constructor(private readonly gitRefSync = new GitRefSync()) {}

  async provision(input: RemoteWorkspaceProvisionInput): Promise<RemoteWorkspaceProvisionResult> {
    const sshHost = input.node.sshHost?.trim();

    if (sshHost === undefined || sshHost === "") {
      return {
        status: "blocked",
        summary: "Remote workspace blocked: selected remote node has no SSH host.",
        actions: ["Skipped remote workspace provisioning because sshHost is missing"]
      };
    }

    const outbound = await this.gitRefSync.prepareOutbound({
      workspacePath: input.localWorkspacePath,
      workerName: input.workerName
    });

    if (outbound.status === "blocked") {
      return {
        status: "blocked",
        summary: outbound.summary,
        actions: outbound.actions
      };
    }

    if (outbound.originUrl === null) {
      return {
        status: "blocked",
        summary: "Remote workspace blocked: outbound git-ref sync did not resolve an origin URL.",
        actions: outbound.actions
      };
    }

    const remoteScratch = await this.gitRefSync.prepareRemoteScratch({
      sshHost,
      originUrl: outbound.originUrl,
      remoteWorkspacePath: input.remoteWorkspacePath,
      workerBranch: outbound.workerBranch,
      workerRef: outbound.workerRef
    });

    if (remoteScratch.status === "blocked") {
      return {
        status: "blocked",
        summary: remoteScratch.summary,
        actions: [...outbound.actions, ...remoteScratch.actions]
      };
    }

    return {
      status: "prepared",
      summary: `Remote workspace prepared at ${input.remoteWorkspacePath} from ${outbound.workerRef}.`,
      actions: [...outbound.actions, ...remoteScratch.actions]
    };
  }
}
