import { resolve } from "node:path";

export function getStateDatabasePath() {
  return resolve(process.env.AGENT_FLEET_DB ?? ".agent-fleet/agent-fleet.sqlite");
}
