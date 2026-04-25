import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CreateAppOptions {
  clientRoot?: string;
}

const defaultClientRoot = join(dirname(fileURLToPath(import.meta.url)), "../client");
const localOriginPattern = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/;

export function createApp(options: CreateAppOptions = {}) {
  const app = fastify({ logger: true });
  const clientRoot = options.clientRoot ?? defaultClientRoot;
  const clientIndex = join(clientRoot, "index.html");

  app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || localOriginPattern.test(origin));
    }
  });

  app.get("/api/health", async () => {
    return { ok: true, service: "agent-fleet" };
  });

  if (existsSync(clientIndex)) {
    app.register(fastifyStatic, { root: clientRoot });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.type("text/html").sendFile("index.html");
      }

      return reply.code(404).send({
        error: "Not Found",
        message: `Route ${request.method}:${request.url} not found`,
        statusCode: 404
      });
    });
  }

  return app;
}
