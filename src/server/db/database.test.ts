import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

describe("openDatabase", () => {
  it("creates the control-plane tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-db-"));
    const dbPath = join(dir, "state.sqlite");

    const db = openDatabase(dbPath);
    const rows = db.sql
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toContain("tasks");
    expect(rows.map((row) => row.name)).toContain("task_events");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
