import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("serves a health response", async () => {
    const app = createApp();

    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, service: "agent-fleet" });
    } finally {
      await app.close();
    }
  });

  it("limits CORS to local browser origins", async () => {
    const app = createApp();

    try {
      const localResponse = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "http://localhost:5173" }
      });
      const remoteResponse = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "https://example.com" }
      });

      expect(localResponse.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      expect(remoteResponse.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("serves a static shell while preserving API 404 responses", async () => {
    const clientRoot = await mkdtemp(join(tmpdir(), "agent-fleet-client-"));
    await writeFile(join(clientRoot, "index.html"), "<!doctype html><div id=\"root\">built shell</div>");
    const app = createApp({ clientRoot });

    try {
      const shellResponse = await app.inject({ method: "GET", url: "/" });
      const apiResponse = await app.inject({ method: "GET", url: "/api/missing" });

      expect(shellResponse.statusCode).toBe(200);
      expect(shellResponse.headers["content-type"]).toContain("text/html");
      expect(shellResponse.body).toContain("built shell");
      expect(apiResponse.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(clientRoot, { recursive: true, force: true });
    }
  });
});
