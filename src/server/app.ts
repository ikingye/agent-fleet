import fastify from "fastify";
import cors from "@fastify/cors";

export function createApp() {
  const app = fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/api/health", async () => {
    return { ok: true, service: "agent-fleet" };
  });

  return app;
}
