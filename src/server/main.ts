import { createApp } from "./app.js";

const port = Number(process.env.AGENT_FLEET_PORT ?? 8787);
const host = process.env.AGENT_FLEET_HOST ?? "127.0.0.1";
const autoDispatch = parseBoolean(process.env.AGENT_FLEET_AUTO_DISPATCH, true);
const dispatchIntervalMs = parsePositiveInteger(process.env.AGENT_FLEET_DISPATCH_INTERVAL_MS, 5000);
const app = createApp({ autoDispatch, dispatchIntervalMs });

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
