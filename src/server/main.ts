import { createApp } from "./http/createApp.js";
import { parseWorkerCommandArgs } from "./workers/commandWorkerAdapter.js";

const host = process.env.AGENT_FLEET_HOST ?? "127.0.0.1";
const port = Number(process.env.AGENT_FLEET_PORT ?? "8787");

const app = await createApp({
  statePath: process.env.AGENT_FLEET_STATE,
  workerCommand: process.env.AGENT_FLEET_WORKER_COMMAND ?? "codexyoloproxy",
  workerArgs: parseWorkerCommandArgs(process.env.AGENT_FLEET_WORKER_ARGS),
  defaultWorkerCwd: process.env.AGENT_FLEET_WORKER_CWD ?? process.cwd()
});

await app.listen({ host, port });
