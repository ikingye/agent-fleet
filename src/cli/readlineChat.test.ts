import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runInteractiveChat } from "./readlineChat.js";

class CaptureOutput extends Writable {
  readonly chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("runInteractiveChat", () => {
  it("handles workspace, project, status, web, chat, and quit commands", async () => {
    const output = new CaptureOutput();
    const client = {
      sendStewardMessage: vi.fn(async () => ({
        ownerMessage: {
          id: "owner-1",
          role: "owner" as const,
          body: "Hello Steward",
          projectName: "mahjong",
          workspacePath: "/tmp/mahjong",
          goalId: null,
          createdAt: "2026-04-27T00:00:00.000Z"
        },
        stewardMessage: {
          id: "steward-1",
          role: "steward" as const,
          body: "Ready to coordinate.",
          projectName: "mahjong",
          workspacePath: "/tmp/mahjong",
          goalId: null,
          createdAt: "2026-04-27T00:00:01.000Z"
        }
      })),
      fetchStatus: vi.fn(async () => ({
        apiUrl: "http://127.0.0.1:8787",
        healthy: true,
        service: "agent-fleet",
        activeGoalsCount: 1,
        activeWorkerSessionsCount: 0,
        lastCheckpointSummary: null,
        nextActions: ["No recovery action needed."]
      }))
    };

    await runInteractiveChat({
      input: Readable.from([
        "/workspace /tmp/mahjong\n",
        "/project mahjong\n",
        "Hello Steward\n",
        "/status\n",
        "/web\n",
        "/quit\n"
      ]),
      output,
      client,
      apiUrl: "http://127.0.0.1:8787",
      workspacePath: "/tmp/agent-fleet",
      projectName: undefined
    });

    expect(client.sendStewardMessage).toHaveBeenCalledWith({
      body: "Hello Steward",
      workspacePath: "/tmp/mahjong",
      projectName: "mahjong"
    });
    expect(client.fetchStatus).toHaveBeenCalledOnce();

    const text = output.text();
    expect(text).toContain("Workspace: /tmp/mahjong");
    expect(text).toContain("Project: mahjong");
    expect(text).toContain("Steward: Ready to coordinate.");
    expect(text).toContain("Active goals: 1");
    expect(text).toContain("Dashboard: http://127.0.0.1:5173");
    expect(text).toContain("Goodbye.");
    expect(text).not.toContain("codex exec");
  });
});
