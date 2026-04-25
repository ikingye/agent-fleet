import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getStateDatabasePath } from "./config/paths.js";
import { registerRoutes, type RouteOptions } from "./routes/routes.js";
import type { CommandRunner } from "./services/commandRunner.js";

export interface CreateAppOptions {
  databasePath?: string;
  clientRoot?: string;
  commandRunner?: CommandRunner;
  autoDispatch?: boolean;
  dispatchIntervalMs?: number;
}

const defaultClientRoot = join(dirname(fileURLToPath(import.meta.url)), "../client");
const localOriginPattern = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/;

function getUrlPath(url: string) {
  return new URL(url, "http://localhost").pathname;
}

function isApiPath(path: string) {
  return path === "/api" || path.startsWith("/api/");
}

function isStaticAssetPath(path: string) {
  const lastSegment = path.split("/").at(-1) ?? "";

  return path.startsWith("/assets/") || /\.[^/.]+$/.test(lastSegment);
}

function shouldServeSpaFallback(method: string, url: string) {
  const path = getUrlPath(url);

  return method === "GET" && !isApiPath(path) && !isStaticAssetPath(path);
}

export function createApp(options: CreateAppOptions = {}) {
  const app = fastify({ logger: true });
  const clientRoot = options.clientRoot ?? defaultClientRoot;
  const clientIndex = join(clientRoot, "index.html");
  const routeOptions: RouteOptions = {
    databasePath: options.databasePath ?? getStateDatabasePath(),
    autoDispatch: options.autoDispatch ?? false
  };

  if (options.dispatchIntervalMs !== undefined) {
    routeOptions.dispatchIntervalMs = options.dispatchIntervalMs;
  }

  if (options.commandRunner !== undefined) {
    routeOptions.commandRunner = options.commandRunner;
  }

  app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || localOriginPattern.test(origin));
    }
  });

  app.get("/api/health", async () => {
    return { ok: true, service: "agent-fleet" };
  });

  app.register(registerRoutes, routeOptions);

  if (existsSync(clientIndex)) {
    app.register(fastifyStatic, { root: clientRoot });

    app.setNotFoundHandler((request, reply) => {
      if (shouldServeSpaFallback(request.method, request.url)) {
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
