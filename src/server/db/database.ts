import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

export interface ControlPlaneDatabase {
  sql: DatabaseSync;
  close(): void;
}

export function openDatabase(path = ".agent-fleet/agent-fleet.sqlite"): ControlPlaneDatabase {
  mkdirSync(dirname(path), { recursive: true });

  const sql = new DatabaseSync(path, {
    timeout: 5000,
    enableForeignKeyConstraints: true
  });

  sql.exec("PRAGMA journal_mode = WAL;");
  sql.exec("PRAGMA foreign_keys = ON;");
  sql.exec(SCHEMA_SQL);

  return {
    sql,
    close: () => sql.close()
  };
}
