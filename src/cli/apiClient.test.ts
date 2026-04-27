import { describe, expect, it, vi } from "vitest";
import {
  createStewardApiClient,
  DEFAULT_STEWARD_CONVERSATION_PATH,
  StewardApiConnectionError
} from "./apiClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe("createStewardApiClient", () => {
  it("falls back to the current Steward messages API when the conversation endpoint is unavailable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Not Found" }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          ownerMessage: { id: "owner-1", role: "owner", body: "Hello" },
          stewardMessage: { id: "steward-1", role: "steward", body: "Ready." }
        })
      );
    const client = createStewardApiClient({
      apiUrl: "http://127.0.0.1:8787/",
      env: { STEWARD_API_TOKEN: "token-123" },
      fetcher: fetcher as unknown as typeof fetch
    });

    const response = await client.sendStewardMessage({
      body: "Hello",
      workspacePath: "/tmp/project",
      projectName: "agent-fleet"
    });

    expect(response.stewardMessage.body).toBe("Ready.");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `http://127.0.0.1:8787${DEFAULT_STEWARD_CONVERSATION_PATH}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123"
        })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/api/steward/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          transport: "cli",
          body: "Hello",
          workspacePath: "/tmp/project",
          projectName: "agent-fleet"
        })
      })
    );
  });

  it("summarizes recovery status without exposing Worker command details", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, service: "agent-fleet" }))
      .mockResolvedValueOnce(
        jsonResponse({
          activeGoalIds: ["goal-1"],
          activeWorkerSessions: [
            {
              id: "worker-1",
              status: "running",
              command: "codex exec --secret-token",
              cwd: "/tmp/project"
            }
          ],
          lastCheckpoint: {
            summary: "Checkpoint recorded."
          },
          nextActions: ["Review active Worker session."]
        })
      );
    const client = createStewardApiClient({ fetcher: fetcher as unknown as typeof fetch });

    await expect(client.fetchStatus()).resolves.toEqual({
      apiUrl: "http://127.0.0.1:8787",
      healthy: true,
      service: "agent-fleet",
      activeGoalsCount: 1,
      activeWorkerSessionsCount: 1,
      lastCheckpointSummary: "Checkpoint recorded.",
      nextActions: ["Review active Worker session."]
    });
  });

  it("reports a clear connection error when the API is not running", async () => {
    const client = createStewardApiClient({
      fetcher: vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch
    });

    await expect(client.fetchStatus()).rejects.toBeInstanceOf(StewardApiConnectionError);
    await expect(client.fetchStatus()).rejects.toThrow("Cannot reach the agent-fleet API at http://127.0.0.1:8787");
  });
});
