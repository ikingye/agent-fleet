import type { DashboardData, GithubDeployKeyLease, WorkerSessionStatus } from "../../shared/types.js";
import type { RemoteGithubDeployKeyProvisioner } from "../remote/remoteKeyProvisioner.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";

export const DEFAULT_GITHUB_DEPLOY_KEY_LEASE_TTL_MS = 6 * 60 * 60 * 1000;

const liveWorkerStatuses = new Set<WorkerSessionStatus>(["starting", "running", "paused"]);

export interface GithubDeployKeyLeaseMaintenanceResult {
  renewedLeaseIds: string[];
  expiredLeaseIds: string[];
  cleanedUpLeaseIds: string[];
  skippedCleanupLeaseIds: string[];
  failedCleanupLeaseIds: string[];
}

export interface MaintainGithubDeployKeyLeasesInput {
  store: JsonControlPlaneStore;
  now?: string;
  leaseTtlMs?: number;
  remoteGithubDeployKeyProvisioner?: Pick<RemoteGithubDeployKeyProvisioner, "cleanupRemoteKey">;
}

export async function maintainGithubDeployKeyLeases(
  input: MaintainGithubDeployKeyLeasesInput
): Promise<GithubDeployKeyLeaseMaintenanceResult> {
  const timestamp = input.now ?? new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(timestamp) + (input.leaseTtlMs ?? DEFAULT_GITHUB_DEPLOY_KEY_LEASE_TTL_MS)
  ).toISOString();
  const initialDashboard = await input.store.dashboard();
  const renewedLeaseIds: string[] = [];

  for (const lease of initialDashboard.githubDeployKeyLeases) {
    if (lease.status !== "active") {
      continue;
    }

    const workerSessionId = firstLiveLeaseHolder(initialDashboard, lease);

    if (workerSessionId === null) {
      continue;
    }

    await input.store.renewGithubDeployKeyLease({
      leaseId: lease.id,
      workerSessionId,
      expiresAt,
      now: timestamp
    });
    renewedLeaseIds.push(lease.id);
  }

  const { expiredLeaseIds } = await input.store.expireGithubDeployKeyLeases({ now: timestamp });
  const dashboardAfterExpiry = await input.store.dashboard();
  const cleanupResult = await cleanupPendingLeases({
    dashboard: dashboardAfterExpiry,
    store: input.store,
    remoteGithubDeployKeyProvisioner: input.remoteGithubDeployKeyProvisioner,
    now: timestamp
  });

  return {
    renewedLeaseIds,
    expiredLeaseIds,
    ...cleanupResult
  };
}

async function cleanupPendingLeases(input: {
  dashboard: DashboardData;
  store: JsonControlPlaneStore;
  remoteGithubDeployKeyProvisioner?: Pick<RemoteGithubDeployKeyProvisioner, "cleanupRemoteKey">;
  now: string;
}): Promise<
  Pick<GithubDeployKeyLeaseMaintenanceResult, "cleanedUpLeaseIds" | "skippedCleanupLeaseIds" | "failedCleanupLeaseIds">
> {
  const cleanedUpLeaseIds: string[] = [];
  const skippedCleanupLeaseIds: string[] = [];
  const failedCleanupLeaseIds: string[] = [];

  if (input.remoteGithubDeployKeyProvisioner === undefined) {
    return { cleanedUpLeaseIds, skippedCleanupLeaseIds, failedCleanupLeaseIds };
  }

  for (const lease of input.dashboard.githubDeployKeyLeases) {
    if (lease.cleanupStatus !== "pending" || lease.status === "active" || lease.refcount > 0) {
      continue;
    }

    if (hasLiveLeaseForSameRemoteKeyPath(input.dashboard, lease)) {
      skippedCleanupLeaseIds.push(lease.id);
      continue;
    }

    const node = input.dashboard.executionNodes.find((item) => item.id === lease.remoteNodeId);
    const sshHost = node?.sshHost?.trim();

    if (sshHost === undefined || sshHost === "") {
      skippedCleanupLeaseIds.push(lease.id);
      continue;
    }

    const cleanup = await input.remoteGithubDeployKeyProvisioner.cleanupRemoteKey({ lease, sshHost });
    await input.store.updateGithubDeployKeyLeaseCleanup({
      leaseId: lease.id,
      cleanupStatus: cleanup.cleanupStatus,
      now: input.now
    });

    if (cleanup.cleanupStatus === "completed") {
      cleanedUpLeaseIds.push(lease.id);
    } else if (cleanup.cleanupStatus === "failed") {
      failedCleanupLeaseIds.push(lease.id);
    }
  }

  return { cleanedUpLeaseIds, skippedCleanupLeaseIds, failedCleanupLeaseIds };
}

function firstLiveLeaseHolder(dashboard: DashboardData, lease: GithubDeployKeyLease): string | null {
  for (const workerSessionId of lease.activeWorkerSessionIds) {
    const session = dashboard.workerSessions.find((item) => item.id === workerSessionId);

    if (
      session !== undefined &&
      session.hostId === lease.remoteNodeId &&
      liveWorkerStatuses.has(session.status)
    ) {
      return workerSessionId;
    }
  }

  return null;
}

function hasLiveLeaseForSameRemoteKeyPath(dashboard: DashboardData, pendingLease: GithubDeployKeyLease): boolean {
  return dashboard.githubDeployKeyLeases.some(
    (lease) =>
      lease.id !== pendingLease.id &&
      lease.status === "active" &&
      lease.remoteNodeId === pendingLease.remoteNodeId &&
      lease.remotePrivateKeyPath === pendingLease.remotePrivateKeyPath &&
      firstLiveLeaseHolder(dashboard, lease) !== null
  );
}
