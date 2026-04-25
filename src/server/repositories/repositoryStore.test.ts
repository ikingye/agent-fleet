import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { RepositoryStore } from "./repositoryStore.js";

describe("RepositoryStore", () => {
  it("persists repositories, tasks, and task state events", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-store-"));
    const dbPath = join(dir, "state.sqlite");
    const db = openDatabase(dbPath);

    try {
      const store = new RepositoryStore(db.sql);
      const project = store.createProject("agent-fleet");
      const repository = store.createRepository({
        projectId: project.id,
        name: "agent-fleet",
        rootPath: "/repo",
        remoteUrl: "https://github.com/ikingye/agent-fleet",
        mainBranch: "main"
      });
      const task = store.createTask({
        repositoryId: repository.id,
        title: "Add health check",
        goal: "Add a health endpoint",
        source: "local",
        sourceUrl: null
      });

      store.transitionTask(task.id, "planned", "orchestrator", "Task planned", { plan: "health" });

      const tasks = store.listTasks(repository.id);
      const events = store.listTaskEvents(task.id);

      expect(tasks).toHaveLength(1);
      expect(events.map((event) => event.state)).toEqual(["queued", "planned"]);
      expect(store.getTask(task.id)?.state).toBe("planned");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists remote execution hosts for offloaded agent work", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-store-"));
    const dbPath = join(dir, "state.sqlite");
    const db = openDatabase(dbPath);

    try {
      const store = new RepositoryStore(db.sql);

      const host = store.createRemoteHost({
        name: "remote-dev",
        sshHost: "remote-dev",
        workRoot: "/root/code/project",
        proxyMode: "auto",
        proxyUrl: "http://127.0.0.1:1080",
        localForwardPort: 8788
      });

      expect(host.sshHost).toBe("remote-dev");
      expect(host.proxyMode).toBe("auto");
      expect(host.proxyUrl).toBe("http://127.0.0.1:1080");
      expect(store.listRemoteHosts()).toEqual([host]);
      expect(store.getRemoteHost(host.id)?.workRoot).toBe("/root/code/project");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
