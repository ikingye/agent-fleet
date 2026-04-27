import type { StewardMessage } from "../shared/types.js";
import { DEFAULT_STEWARD_API_URL, normalizeApiUrl } from "./args.js";

export const DEFAULT_STEWARD_CONVERSATION_PATH = "/api/conversations/steward-cli/messages";
const STEWARD_MESSAGES_PATH = "/api/steward/messages";

export interface SendStewardMessageInput {
  body: string;
  workspacePath?: string;
  projectName?: string;
  goalId?: string;
}

export interface SendStewardMessageResponse {
  ownerMessage: StewardMessage;
  stewardMessage: StewardMessage;
}

export interface StewardStatusSummary {
  apiUrl: string;
  healthy: boolean;
  service: string;
  activeGoalsCount: number;
  activeWorkerSessionsCount: number;
  lastCheckpointSummary: string | null;
  nextActions: string[];
}

export interface StewardApiClient {
  sendStewardMessage(input: SendStewardMessageInput): Promise<SendStewardMessageResponse>;
  fetchStatus(): Promise<StewardStatusSummary>;
}

export interface CreateStewardApiClientOptions {
  apiUrl?: string;
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
}

export class StewardApiConnectionError extends Error {
  constructor(apiUrl: string, cause: unknown) {
    super(
      `Cannot reach the agent-fleet API at ${apiUrl}. Start the server with "npm run dev" or "steward serve", then try again.`
    );
    this.name = "StewardApiConnectionError";
    this.cause = cause;
  }
}

export class StewardApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StewardApiHttpError";
    this.status = status;
  }
}

function resolveToken(env: Record<string, string | undefined>): string | undefined {
  return env.STEWARD_API_TOKEN ?? env.AGENT_FLEET_API_TOKEN;
}

function jsonHeaders(token: string | undefined): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: unknown; error?: unknown };

    if (typeof data.message === "string" && data.message.trim() !== "") {
      return data.message;
    }

    if (typeof data.error === "string" && data.error.trim() !== "") {
      return data.error;
    }
  } catch {
    // Fall through to status text.
  }

  return response.statusText || `HTTP ${response.status}`;
}

function buildBody(input: SendStewardMessageInput): string {
  return JSON.stringify({
    transport: "cli",
    body: input.body,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    ...(input.projectName ? { projectName: input.projectName } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {})
  });
}

function isFallbackStatus(error: unknown): boolean {
  return error instanceof StewardApiHttpError && (error.status === 404 || error.status === 405);
}

function readCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readNextActions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readLastCheckpointSummary(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  const summary = (value as { summary?: unknown }).summary;

  return typeof summary === "string" && summary.trim() !== "" ? summary : null;
}

export function createStewardApiClient(options: CreateStewardApiClientOptions = {}): StewardApiClient {
  const env = options.env ?? process.env;
  const apiUrl = normalizeApiUrl(options.apiUrl ?? env.STEWARD_API_URL ?? DEFAULT_STEWARD_API_URL);
  const fetcher = options.fetcher ?? fetch;
  const token = resolveToken(env);

  async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;

    try {
      response = await fetcher(`${apiUrl}${path}`, {
        ...init,
        headers: {
          ...jsonHeaders(token),
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      throw new StewardApiConnectionError(apiUrl, error);
    }

    if (!response.ok) {
      throw new StewardApiHttpError(response.status, await parseErrorMessage(response));
    }

    return response.json() as Promise<T>;
  }

  return {
    async sendStewardMessage(input) {
      const init = {
        method: "POST",
        body: buildBody(input)
      };

      try {
        return await requestJson<SendStewardMessageResponse>(DEFAULT_STEWARD_CONVERSATION_PATH, init);
      } catch (error) {
        if (!isFallbackStatus(error)) {
          throw error;
        }
      }

      return requestJson<SendStewardMessageResponse>(STEWARD_MESSAGES_PATH, init);
    },

    async fetchStatus() {
      const health = await requestJson<{ ok?: unknown; service?: unknown }>("/api/health");

      try {
        const recovery = await requestJson<{
          activeGoalIds?: unknown;
          activeWorkerSessions?: unknown;
          lastCheckpoint?: unknown;
          nextActions?: unknown;
        }>("/api/recovery");

        return {
          apiUrl,
          healthy: health.ok === true,
          service: typeof health.service === "string" ? health.service : "agent-fleet",
          activeGoalsCount: readCount(recovery.activeGoalIds),
          activeWorkerSessionsCount: readCount(recovery.activeWorkerSessions),
          lastCheckpointSummary: readLastCheckpointSummary(recovery.lastCheckpoint),
          nextActions: readNextActions(recovery.nextActions)
        };
      } catch (error) {
        if (!isFallbackStatus(error)) {
          throw error;
        }
      }

      const dashboard = await requestJson<{
        goals?: unknown;
        workerSessions?: unknown;
        stewardCheckpoints?: unknown;
      }>("/api/dashboard");
      const checkpoints = Array.isArray(dashboard.stewardCheckpoints) ? dashboard.stewardCheckpoints : [];

      return {
        apiUrl,
        healthy: health.ok === true,
        service: typeof health.service === "string" ? health.service : "agent-fleet",
        activeGoalsCount: readCount(dashboard.goals),
        activeWorkerSessionsCount: readCount(dashboard.workerSessions),
        lastCheckpointSummary: readLastCheckpointSummary(checkpoints.at(-1)),
        nextActions: []
      };
    }
  };
}
