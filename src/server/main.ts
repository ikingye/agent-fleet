import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.AGENT_FLEET_PORT ?? 8787);
const host = process.env.AGENT_FLEET_HOST ?? "127.0.0.1";

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
