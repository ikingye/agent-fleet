# agent-fleet MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local macOS-first MVP where agent-fleet can register its own repository, create tasks, allocate git worktrees, run Codex workers, run quality gates and review, merge successful work to `main`, and show all progress in a local web console.

**Architecture:** A single TypeScript project contains a Fastify API server, Vite React web console, SQLite control-plane store, orchestrator service, worktree manager, Codex adapter, quality gate runner, and GitHub integration. Runtime state is persisted under `.agent-fleet/` and task worktrees are created under `.worktrees/`, both ignored by git.

**Tech Stack:** npm, Node.js >= 24, TypeScript, Fastify, Vite + React, Vitest, Playwright, Node `node:sqlite`, Git CLI, GitHub CLI, Codex CLI.

---

## Source Spec

Implement [docs/superpowers/specs/2026-04-25-agent-fleet-mvp-design.md](/Users/yewang/code/project/agent-fleet/docs/superpowers/specs/2026-04-25-agent-fleet-mvp-design.md).

## Scope Check

The spec covers several subsystems, but the MVP must prove one vertical loop: local task input -> orchestrator -> worktree -> Codex worker -> quality gate -> review -> merge/push -> dashboard. This plan keeps all work in one repo and one local process, with focused modules so future Claude Code, Gemini CLI, and distributed workers can be added without changing the core task lifecycle.

## File Structure

Create this structure:

```text
.
├── .github/workflows/ci.yml
├── docs/superpowers/plans/2026-04-25-agent-fleet-mvp.md
├── eslint.config.js
├── index.html
├── package.json
├── playwright.config.ts
├── src
│   ├── client
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── server
│   │   ├── app.ts
│   │   ├── config
│   │   │   └── paths.ts
│   │   ├── db
│   │   │   ├── database.test.ts
│   │   │   ├── database.ts
│   │   │   └── schema.ts
│   │   ├── github
│   │   │   ├── githubClient.test.ts
│   │   │   └── githubClient.ts
│   │   ├── main.ts
│   │   ├── orchestrator
│   │   │   ├── orchestrator.test.ts
│   │   │   └── orchestrator.ts
│   │   ├── quality
│   │   │   ├── qualityGate.test.ts
│   │   │   └── qualityGate.ts
│   │   ├── review
│   │   │   ├── reviewGate.test.ts
│   │   │   └── reviewGate.ts
│   │   ├── repositories
│   │   │   ├── repositoryStore.test.ts
│   │   │   └── repositoryStore.ts
│   │   ├── routes
│   │   │   ├── routes.test.ts
│   │   │   └── routes.ts
│   │   ├── services
│   │   │   ├── agentAdapter.ts
│   │   │   ├── codexAdapter.test.ts
│   │   │   ├── codexAdapter.ts
│   │   │   ├── commandRunner.test.ts
│   │   │   ├── commandRunner.ts
│   │   │   ├── worktreeManager.test.ts
│   │   │   └── worktreeManager.ts
│   │   └── app.test.ts
│   └── shared
│       └── types.ts
├── tests/e2e/dashboard.spec.ts
├── tsconfig.base.json
├── tsconfig.server.json
├── tsconfig.web.json
├── vite.config.ts
└── vitest.config.ts
```

Responsibilities:

- `src/shared/types.ts`: shared task, repository, event, agent, check, and review types.
- `src/server/db/*`: SQLite schema and database opening/migration.
- `src/server/repositories/repositoryStore.ts`: typed persistence operations.
- `src/server/services/commandRunner.ts`: process execution abstraction for Git, GitHub CLI, quality commands, and Codex.
- `src/server/services/worktreeManager.ts`: all git worktree, merge, and push operations.
- `src/server/services/agentAdapter.ts`: stable adapter contract.
- `src/server/services/codexAdapter.ts`: Codex CLI implementation.
- `src/server/quality/qualityGate.ts`: configured quality command runner.
- `src/server/review/reviewGate.ts`: Codex-backed reviewer pass that must approve before merge.
- `src/server/github/githubClient.ts`: GitHub issue import through `gh`.
- `src/server/orchestrator/orchestrator.ts`: autonomous state machine.
- `src/server/routes/routes.ts`: Fastify API routes.
- `src/client/*`: local web console.

## Task 1: Project Baseline, Fastify Health, and Vite Shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.server.json`
- Create: `tsconfig.web.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `index.html`
- Create: `src/server/app.test.ts`
- Create: `src/server/app.ts`
- Create: `src/server/main.ts`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/styles.css`

- [ ] **Step 1: Create package and TypeScript configuration**

Create `package.json`:

```json
{
  "name": "agent-fleet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.0.0",
    "npm": ">=10.0.0"
  },
  "scripts": {
    "dev": "concurrently -k -n server,web \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "tsx watch src/server/main.ts",
    "dev:web": "vite --host 127.0.0.1 --port 5173",
    "build": "npm run typecheck && vite build && tsc -p tsconfig.server.json",
    "start": "node dist/server/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "check": "npm run typecheck && npm run lint && npm run test"
  },
  "dependencies": {
    "@fastify/cors": "^11.0.0",
    "@fastify/static": "^8.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "fastify": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@playwright/test": "^1.55.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "concurrently": "^9.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react-hooks": "^7.0.0",
    "eslint-plugin-react-refresh": "^0.4.0",
    "jsdom": "^27.0.0",
    "prettier": "^3.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.9.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^7.0.0",
    "vitest": "^4.0.0"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "useDefineForClassFields": true,
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@server/*": ["src/server/*"],
      "@client/*": ["src/client/*"]
    }
  }
}
```

Create `tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist/server",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/server/**/*.ts", "src/shared/**/*.ts"]
}
```

Create `tsconfig.web.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/client/**/*.ts", "src/client/**/*.tsx", "src/shared/**/*.ts", "vite.config.ts"]
}
```

- [ ] **Step 2: Create Vite and Vitest configuration**

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
```

Create `eslint.config.js`:

```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "build",
      "coverage",
      "playwright-report",
      "test-results",
      ".agent-fleet",
      ".worktrees",
      ".superpowers"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off"
    }
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  }
);
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and `npm` exits with status `0`.

- [ ] **Step 4: Write the failing health test**

Create `src/server/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("serves a health response", async () => {
    const app = createApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "agent-fleet" });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run:

```bash
npm test -- src/server/app.test.ts
```

Expected: FAIL because `src/server/app.ts` does not exist.

- [ ] **Step 6: Implement Fastify health app**

Create `src/server/app.ts`:

```ts
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
```

Create `src/server/main.ts`:

```ts
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
```

- [ ] **Step 7: Add minimal React shell**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>agent-fleet</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

Create `src/client/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `src/client/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local Orchestrator</p>
          <h1>agent-fleet</h1>
        </div>
        <span className="status-pill">MVP</span>
      </header>
      <section className="empty-state">
        <h2>Fleet dashboard</h2>
        <p>Task queue, agent runs, worktrees, checks, review, merge, and push status will appear here.</p>
      </section>
    </main>
  );
}
```

Create `src/client/styles.css`:

```css
:root {
  color: #182026;
  background: #f5f7f8;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid #d8dee3;
  background: #ffffff;
}

.eyebrow {
  margin: 0 0 4px;
  color: #56616b;
  font-size: 12px;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

.status-pill {
  border: 1px solid #b9c4cc;
  border-radius: 999px;
  padding: 6px 10px;
  color: #37414a;
}

.empty-state {
  padding: 28px;
}
```

- [ ] **Step 8: Verify baseline**

Run:

```bash
npm test -- src/server/app.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit with status `0`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.server.json tsconfig.web.json vite.config.ts vitest.config.ts eslint.config.js index.html src/server src/client
git commit -m "feat: scaffold local web console and api"
```

## Task 2: Shared Types and SQLite Control Plane

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/server/db/schema.ts`
- Create: `src/server/db/database.test.ts`
- Create: `src/server/db/database.ts`

- [ ] **Step 1: Write shared lifecycle types**

Create `src/shared/types.ts`:

```ts
export type TaskState =
  | "queued"
  | "planned"
  | "worktree_ready"
  | "agent_running"
  | "changes_ready"
  | "checks_running"
  | "reviewing"
  | "merge_ready"
  | "merged"
  | "pushed"
  | "blocked"
  | "needs_clarification"
  | "retrying"
  | "failed";

export type AgentKind = "codex" | "claude_code" | "gemini_cli";

export type CheckStatus = "passed" | "failed" | "unavailable";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Repository {
  id: string;
  projectId: string;
  name: string;
  rootPath: string;
  remoteUrl: string | null;
  mainBranch: string;
  createdAt: string;
}

export interface Task {
  id: string;
  repositoryId: string;
  title: string;
  goal: string;
  state: TaskState;
  source: "local" | "github_issue";
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  actor: "user" | "orchestrator" | "worker" | "quality_gate" | "reviewer" | "github";
  state: TaskState;
  message: string;
  metadataJson: string;
  createdAt: string;
}

export interface WorktreeRecord {
  id: string;
  taskId: string;
  repositoryId: string;
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
  removedAt: string | null;
}

export interface AgentRun {
  id: string;
  taskId: string;
  kind: AgentKind;
  status: "running" | "succeeded" | "failed" | "stopped";
  worktreePath: string;
  logPath: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface CheckRun {
  id: string;
  taskId: string;
  name: string;
  command: string;
  status: CheckStatus;
  output: string;
  createdAt: string;
}
```

- [ ] **Step 2: Write failing database migration test**

Create `src/server/db/database.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm test -- src/server/db/database.test.ts
```

Expected: FAIL because `src/server/db/database.ts` does not exist.

- [ ] **Step 4: Implement SQLite schema and database opener**

Create `src/server/db/schema.ts`:

```ts
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  remote_url TEXT,
  main_branch TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  actor TEXT NOT NULL,
  state TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  log_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS merge_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`;
```

Create `src/server/db/database.ts`:

```ts
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
```

- [ ] **Step 5: Verify database task**

Run:

```bash
npm test -- src/server/db/database.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/server/db
git commit -m "feat: add sqlite control plane schema"
```

## Task 3: Repository Store and Task Events

**Files:**
- Create: `src/server/repositories/repositoryStore.test.ts`
- Create: `src/server/repositories/repositoryStore.ts`

- [ ] **Step 1: Write failing repository store test**

Create `src/server/repositories/repositoryStore.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { RepositoryStore } from "./repositoryStore.js";

describe("RepositoryStore", () => {
  it("creates a project, repository, task, and task events", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-store-"));
    const db = openDatabase(join(dir, "state.sqlite"));
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
    const timeline = store.listTaskEvents(task.id);

    expect(store.listTasks()).toHaveLength(1);
    expect(timeline.map((event) => event.state)).toEqual(["queued", "planned"]);
    expect(store.getTask(task.id)?.state).toBe("planned");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/server/repositories/repositoryStore.test.ts
```

Expected: FAIL because `RepositoryStore` does not exist.

- [ ] **Step 3: Implement repository store**

Create `src/server/repositories/repositoryStore.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Project, Repository, Task, TaskEvent, TaskState } from "../../shared/types.js";

type TaskActor = TaskEvent["actor"];

function now() {
  return new Date().toISOString();
}

function mapProject(row: Record<string, unknown>): Project {
  return { id: String(row.id), name: String(row.name), createdAt: String(row.created_at) };
}

function mapRepository(row: Record<string, unknown>): Repository {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    rootPath: String(row.root_path),
    remoteUrl: row.remote_url === null ? null : String(row.remote_url),
    mainBranch: String(row.main_branch),
    createdAt: String(row.created_at)
  };
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    title: String(row.title),
    goal: String(row.goal),
    state: row.state as TaskState,
    source: row.source as Task["source"],
    sourceUrl: row.source_url === null ? null : String(row.source_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapTaskEvent(row: Record<string, unknown>): TaskEvent {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    actor: row.actor as TaskActor,
    state: row.state as TaskState,
    message: String(row.message),
    metadataJson: String(row.metadata_json),
    createdAt: String(row.created_at)
  };
}

export class RepositoryStore {
  constructor(private readonly db: DatabaseSync) {}

  createProject(name: string): Project {
    const project: Project = { id: randomUUID(), name, createdAt: now() };
    this.db
      .prepare("insert into projects (id, name, created_at) values (?, ?, ?)")
      .run(project.id, project.name, project.createdAt);
    return project;
  }

  createRepository(input: {
    projectId: string;
    name: string;
    rootPath: string;
    remoteUrl: string | null;
    mainBranch: string;
  }): Repository {
    const repository: Repository = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      rootPath: input.rootPath,
      remoteUrl: input.remoteUrl,
      mainBranch: input.mainBranch,
      createdAt: now()
    };
    this.db
      .prepare(
        "insert into repositories (id, project_id, name, root_path, remote_url, main_branch, created_at) values (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        repository.id,
        repository.projectId,
        repository.name,
        repository.rootPath,
        repository.remoteUrl,
        repository.mainBranch,
        repository.createdAt
      );
    return repository;
  }

  getRepository(id: string): Repository | null {
    const row = this.db.prepare("select * from repositories where id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapRepository(row) : null;
  }

  listRepositories(): Repository[] {
    return (this.db.prepare("select * from repositories order by created_at").all() as Record<string, unknown>[]).map(
      mapRepository
    );
  }

  createTask(input: {
    repositoryId: string;
    title: string;
    goal: string;
    source: Task["source"];
    sourceUrl: string | null;
  }): Task {
    const timestamp = now();
    const task: Task = {
      id: randomUUID(),
      repositoryId: input.repositoryId,
      title: input.title,
      goal: input.goal,
      state: "queued",
      source: input.source,
      sourceUrl: input.sourceUrl,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db
      .prepare(
        "insert into tasks (id, repository_id, title, goal, state, source, source_url, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        task.id,
        task.repositoryId,
        task.title,
        task.goal,
        task.state,
        task.source,
        task.sourceUrl,
        task.createdAt,
        task.updatedAt
      );
    this.appendTaskEvent(task.id, "user", "queued", "Task queued", {});
    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("select * from tasks where id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapTask(row) : null;
  }

  listTasks(): Task[] {
    return (this.db.prepare("select * from tasks order by created_at desc").all() as Record<string, unknown>[]).map(
      mapTask
    );
  }

  listQueuedTasks(limit = 1): Task[] {
    return (
      this.db.prepare("select * from tasks where state = 'queued' order by created_at limit ?").all(limit) as Record<
        string,
        unknown
      >[]
    ).map(mapTask);
  }

  transitionTask(
    taskId: string,
    state: TaskState,
    actor: TaskActor,
    message: string,
    metadata: Record<string, unknown>
  ): TaskEvent {
    const timestamp = now();
    this.db.prepare("update tasks set state = ?, updated_at = ? where id = ?").run(state, timestamp, taskId);
    return this.appendTaskEvent(taskId, actor, state, message, metadata);
  }

  appendTaskEvent(
    taskId: string,
    actor: TaskActor,
    state: TaskState,
    message: string,
    metadata: Record<string, unknown>
  ): TaskEvent {
    const event: TaskEvent = {
      id: randomUUID(),
      taskId,
      actor,
      state,
      message,
      metadataJson: JSON.stringify(metadata),
      createdAt: now()
    };
    this.db
      .prepare(
        "insert into task_events (id, task_id, actor, state, message, metadata_json, created_at) values (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(event.id, event.taskId, event.actor, event.state, event.message, event.metadataJson, event.createdAt);
    return event;
  }

  listTaskEvents(taskId: string): TaskEvent[] {
    return (
      this.db.prepare("select * from task_events where task_id = ? order by created_at, rowid").all(taskId) as Record<
        string,
        unknown
      >[]
    ).map(mapTaskEvent);
  }
}
```

- [ ] **Step 4: Verify repository store**

Run:

```bash
npm test -- src/server/repositories/repositoryStore.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories
git commit -m "feat: persist projects repositories and task events"
```

## Task 4: Command Runner and Worktree Manager

**Files:**
- Create: `src/server/services/commandRunner.test.ts`
- Create: `src/server/services/commandRunner.ts`
- Create: `src/server/services/worktreeManager.test.ts`
- Create: `src/server/services/worktreeManager.ts`

- [ ] **Step 1: Write command runner test**

Create `src/server/services/commandRunner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "./commandRunner.js";

describe("createCommandRunner", () => {
  it("captures stdout and exit code", async () => {
    const runner = createCommandRunner();
    const result = await runner.run("node", ["-e", "console.log('ok')"], { cwd: process.cwd() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});
```

- [ ] **Step 2: Implement command runner**

Create `src/server/services/commandRunner.ts`:

```ts
import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<CommandResult>;
}

export function createCommandRunner(): CommandRunner {
  return {
    run(command, args, options) {
      return new Promise<CommandResult>((resolve) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          shell: false
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` });
        });
        child.on("close", (exitCode) => {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });
      });
    }
  };
}
```

- [ ] **Step 3: Write failing worktree manager test**

Create `src/server/services/worktreeManager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "./commandRunner.js";
import { WorktreeManager } from "./worktreeManager.js";

describe("WorktreeManager", () => {
  it("creates an isolated branch and worktree path", async () => {
    const calls: string[] = [];
    const runner: CommandRunner = {
      async run(command, args, options) {
        calls.push(`${options.cwd}$ ${command} ${args.join(" ")}`);
        if (args.join(" ") === "rev-parse HEAD") {
          return { exitCode: 0, stdout: "abc123\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    };
    const manager = new WorktreeManager(runner);

    const result = await manager.createWorktree({
      repositoryId: "repo-1",
      repositoryRoot: "/repo",
      mainBranch: "main",
      taskId: "task-1",
      taskTitle: "Add API health"
    });

    expect(result.branch).toBe("agent-fleet/task-1-add-api-health");
    expect(result.path).toBe("/repo/.worktrees/task-1-add-api-health");
    expect(result.baseCommit).toBe("abc123");
    expect(calls).toContain("/repo$ git worktree add -b agent-fleet/task-1-add-api-health /repo/.worktrees/task-1-add-api-health main");
  });
});
```

- [ ] **Step 4: Implement worktree manager**

Create `src/server/services/worktreeManager.ts`:

```ts
import { join } from "node:path";
import type { CommandRunner } from "./commandRunner.js";

export interface CreateWorktreeInput {
  repositoryId: string;
  repositoryRoot: string;
  mainBranch: string;
  taskId: string;
  taskTitle: string;
}

export interface CreatedWorktree {
  repositoryId: string;
  taskId: string;
  path: string;
  branch: string;
  baseCommit: string;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function assertCommandOk(result: { exitCode: number; stdout: string; stderr: string }, command: string) {
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

export class WorktreeManager {
  constructor(private readonly runner: CommandRunner) {}

  async createWorktree(input: CreateWorktreeInput): Promise<CreatedWorktree> {
    const branch = `agent-fleet/${input.taskId}-${slugify(input.taskTitle)}`;
    const path = join(input.repositoryRoot, ".worktrees", `${input.taskId}-${slugify(input.taskTitle)}`);

    const status = await this.runner.run("git", ["status", "--porcelain"], { cwd: input.repositoryRoot });
    assertCommandOk(status, "git status --porcelain");
    if (status.stdout.trim().length > 0) {
      throw new Error("Repository has uncommitted changes; refusing to create autonomous worktree");
    }

    const base = await this.runner.run("git", ["rev-parse", "HEAD"], { cwd: input.repositoryRoot });
    assertCommandOk(base, "git rev-parse HEAD");

    const add = await this.runner.run("git", ["worktree", "add", "-b", branch, path, input.mainBranch], {
      cwd: input.repositoryRoot
    });
    assertCommandOk(add, "git worktree add");

    return {
      repositoryId: input.repositoryId,
      taskId: input.taskId,
      path,
      branch,
      baseCommit: base.stdout.trim()
    };
  }

  async mergeToMain(input: { repositoryRoot: string; mainBranch: string; branch: string; message: string }) {
    for (const args of [
      ["checkout", input.mainBranch],
      ["pull", "--ff-only", "origin", input.mainBranch],
      ["merge", "--no-ff", input.branch, "-m", input.message],
      ["push", "origin", input.mainBranch]
    ]) {
      const result = await this.runner.run("git", args, { cwd: input.repositoryRoot });
      assertCommandOk(result, `git ${args.join(" ")}`);
    }
  }
}
```

- [ ] **Step 5: Verify worktree manager**

Run:

```bash
npm test -- src/server/services/commandRunner.test.ts src/server/services/worktreeManager.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/commandRunner.ts src/server/services/commandRunner.test.ts src/server/services/worktreeManager.ts src/server/services/worktreeManager.test.ts
git commit -m "feat: add command runner and worktree manager"
```

## Task 5: Codex Agent Adapter

**Files:**
- Create: `src/server/services/agentAdapter.ts`
- Create: `src/server/services/codexAdapter.test.ts`
- Create: `src/server/services/codexAdapter.ts`

- [ ] **Step 1: Define adapter interface**

Create `src/server/services/agentAdapter.ts`:

```ts
import type { AgentKind } from "../../shared/types.js";

export interface AgentStartInput {
  taskId: string;
  worktreePath: string;
  prompt: string;
  logPath: string;
}

export interface AgentRunResult {
  kind: AgentKind;
  status: "succeeded" | "failed";
  output: string;
  logPath: string;
}

export interface AgentAdapter {
  kind: AgentKind;
  detect(): Promise<{ available: boolean; version: string | null; message: string }>;
  start(input: AgentStartInput): Promise<AgentRunResult>;
}
```

- [ ] **Step 2: Write failing Codex adapter test**

Create `src/server/services/codexAdapter.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "./commandRunner.js";
import { CodexAdapter } from "./codexAdapter.js";

describe("CodexAdapter", () => {
  it("detects Codex and runs codex exec in the worktree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-codex-"));
    const logPath = join(dir, "codex.log");
    const calls: string[] = [];
    const runner: CommandRunner = {
      async run(command, args, options) {
        calls.push(`${options.cwd}$ ${command} ${args.join(" ")}`);
        if (args.includes("--version")) {
          return { exitCode: 0, stdout: "codex-cli 0.125.0\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      }
    };
    const adapter = new CodexAdapter(runner);

    const detection = await adapter.detect();
    const result = await adapter.start({
      taskId: "task-1",
      worktreePath: dir,
      prompt: "Implement a small change",
      logPath
    });

    expect(detection.available).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(calls).toContain(`${dir}$ codex exec --sandbox danger-full-access Implement a small change`);
    expect(readFileSync(logPath, "utf8")).toContain("done");

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Implement Codex adapter**

Create `src/server/services/codexAdapter.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentAdapter, AgentRunResult, AgentStartInput } from "./agentAdapter.js";
import type { CommandRunner } from "./commandRunner.js";

export class CodexAdapter implements AgentAdapter {
  readonly kind = "codex" as const;

  constructor(private readonly runner: CommandRunner) {}

  async detect() {
    const result = await this.runner.run("codex", ["--version"], { cwd: process.cwd() });
    return {
      available: result.exitCode === 0,
      version: result.exitCode === 0 ? result.stdout.trim() : null,
      message: result.exitCode === 0 ? "Codex CLI available" : result.stderr || result.stdout
    };
  }

  async start(input: AgentStartInput): Promise<AgentRunResult> {
    mkdirSync(dirname(input.logPath), { recursive: true });
    const result = await this.runner.run("codex", ["exec", "--sandbox", "danger-full-access", input.prompt], {
      cwd: input.worktreePath
    });
    const output = `${result.stdout}${result.stderr}`;
    writeFileSync(input.logPath, output);

    return {
      kind: this.kind,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      output,
      logPath: input.logPath
    };
  }
}
```

- [ ] **Step 4: Verify Codex adapter**

Run:

```bash
npm test -- src/server/services/codexAdapter.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/agentAdapter.ts src/server/services/codexAdapter.ts src/server/services/codexAdapter.test.ts
git commit -m "feat: add codex agent adapter"
```

## Task 6: Quality Gate Runner

**Files:**
- Create: `src/server/quality/qualityGate.test.ts`
- Create: `src/server/quality/qualityGate.ts`

- [ ] **Step 1: Write failing quality gate test**

Create `src/server/quality/qualityGate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "../services/commandRunner.js";
import { QualityGate } from "./qualityGate.js";

describe("QualityGate", () => {
  it("runs configured checks and reports failures", async () => {
    const runner: CommandRunner = {
      async run(_command, args) {
        const command = args.join(" ");
        if (command.includes("npm run test")) {
          return { exitCode: 1, stdout: "", stderr: "test failed" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    };
    const gate = new QualityGate(runner);

    const result = await gate.run({
      taskId: "task-1",
      repositoryRoot: "/repo",
      commands: [
        { name: "typecheck", command: "npm run typecheck" },
        { name: "unit", command: "npm run test" }
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.checks.map((check) => check.status)).toEqual(["passed", "failed"]);
  });
});
```

- [ ] **Step 2: Implement quality gate**

Create `src/server/quality/qualityGate.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { CheckRun } from "../../shared/types.js";
import type { CommandRunner } from "../services/commandRunner.js";

export interface QualityCommand {
  name: string;
  command: string;
}

export interface QualityGateInput {
  taskId: string;
  repositoryRoot: string;
  commands: QualityCommand[];
}

export interface QualityGateResult {
  passed: boolean;
  checks: CheckRun[];
}

function now() {
  return new Date().toISOString();
}

export class QualityGate {
  constructor(private readonly runner: CommandRunner) {}

  async run(input: QualityGateInput): Promise<QualityGateResult> {
    if (input.commands.length === 0) {
      return {
        passed: true,
        checks: [
          {
            id: randomUUID(),
            taskId: input.taskId,
            name: "quality",
            command: "",
            status: "unavailable",
            output: "No quality commands configured",
            createdAt: now()
          }
        ]
      };
    }

    const checks: CheckRun[] = [];
    for (const command of input.commands) {
      const result = await this.runner.run("sh", ["-lc", command.command], { cwd: input.repositoryRoot });
      checks.push({
        id: randomUUID(),
        taskId: input.taskId,
        name: command.name,
        command: command.command,
        status: result.exitCode === 0 ? "passed" : "failed",
        output: `${result.stdout}${result.stderr}`,
        createdAt: now()
      });
    }

    return {
      passed: checks.every((check) => check.status !== "failed"),
      checks
    };
  }
}
```

- [ ] **Step 3: Verify quality gate**

Run:

```bash
npm test -- src/server/quality/qualityGate.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 4: Commit**

```bash
git add src/server/quality
git commit -m "feat: add quality gate runner"
```

## Task 7: Review Gate Runner

**Files:**
- Create: `src/server/review/reviewGate.test.ts`
- Create: `src/server/review/reviewGate.ts`

- [ ] **Step 1: Write failing review gate test**

Create `src/server/review/reviewGate.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../services/agentAdapter.js";
import { ReviewGate } from "./reviewGate.js";

describe("ReviewGate", () => {
  it("passes only when the reviewer explicitly approves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-review-"));
    const adapter: AgentAdapter = {
      kind: "codex",
      async detect() {
        return { available: true, version: "codex-cli 0.125.0", message: "ok" };
      },
      async start(input) {
        return {
          kind: "codex",
          status: "succeeded",
          output: `APPROVED\nReviewed ${input.taskId}`,
          logPath: input.logPath
        };
      }
    };
    const gate = new ReviewGate(adapter);

    const result = await gate.run({
      taskId: "task-1",
      worktreePath: dir,
      goal: "Add dashboard",
      logRoot: join(dir, ".agent-fleet", "logs")
    });

    expect(result.passed).toBe(true);
    expect(result.summary).toContain("APPROVED");

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Implement review gate**

Create `src/server/review/reviewGate.ts`:

```ts
import { join } from "node:path";
import type { AgentAdapter } from "../services/agentAdapter.js";

export interface ReviewGateInput {
  taskId: string;
  worktreePath: string;
  goal: string;
  logRoot: string;
}

export interface ReviewGateResult {
  passed: boolean;
  summary: string;
}

export class ReviewGate {
  constructor(private readonly reviewer: AgentAdapter) {}

  async run(input: ReviewGateInput): Promise<ReviewGateResult> {
    const prompt = [
      "Review the current worktree for defects, regressions, missing tests, and risky behavior changes.",
      "Respond with APPROVED on the first line only if the work is ready to merge.",
      "Respond with CHANGES_REQUESTED on the first line if fixes are required.",
      "",
      `Goal: ${input.goal}`
    ].join("\n");

    const run = await this.reviewer.start({
      taskId: input.taskId,
      worktreePath: input.worktreePath,
      prompt,
      logPath: join(input.logRoot, `${input.taskId}-review.log`)
    });

    const summary = run.output.trim();
    return {
      passed: run.status === "succeeded" && summary.startsWith("APPROVED"),
      summary
    };
  }
}
```

- [ ] **Step 3: Verify review gate**

Run:

```bash
npm test -- src/server/review/reviewGate.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 4: Commit**

```bash
git add src/server/review
git commit -m "feat: add codex review gate"
```

## Task 8: GitHub Issue Import

**Files:**
- Create: `src/server/github/githubClient.test.ts`
- Create: `src/server/github/githubClient.ts`

- [ ] **Step 1: Write failing GitHub client test**

Create `src/server/github/githubClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "../services/commandRunner.js";
import { GitHubClient } from "./githubClient.js";

describe("GitHubClient", () => {
  it("imports an issue by repo and number", async () => {
    const runner: CommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            title: "Add dashboard",
            body: "Build the local dashboard",
            url: "https://github.com/ikingye/agent-fleet/issues/1"
          }),
          stderr: ""
        };
      }
    };
    const client = new GitHubClient(runner);

    const issue = await client.getIssue("ikingye/agent-fleet", 1);

    expect(issue).toEqual({
      title: "Add dashboard",
      goal: "Build the local dashboard",
      url: "https://github.com/ikingye/agent-fleet/issues/1"
    });
  });
});
```

- [ ] **Step 2: Implement GitHub client**

Create `src/server/github/githubClient.ts`:

```ts
import type { CommandRunner } from "../services/commandRunner.js";

export interface ImportedIssue {
  title: string;
  goal: string;
  url: string;
}

interface GhIssueJson {
  title: string;
  body: string | null;
  url: string;
}

export class GitHubClient {
  constructor(private readonly runner: CommandRunner) {}

  async getIssue(repository: string, issueNumber: number): Promise<ImportedIssue> {
    const result = await this.runner.run(
      "gh",
      ["issue", "view", String(issueNumber), "--repo", repository, "--json", "title,body,url"],
      { cwd: process.cwd() }
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "gh issue view failed");
    }
    const issue = JSON.parse(result.stdout) as GhIssueJson;
    return {
      title: issue.title,
      goal: issue.body?.trim() || issue.title,
      url: issue.url
    };
  }
}
```

- [ ] **Step 3: Verify GitHub client**

Run:

```bash
npm test -- src/server/github/githubClient.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 4: Commit**

```bash
git add src/server/github
git commit -m "feat: import github issues with gh"
```

## Task 9: Orchestrator State Machine

**Files:**
- Create: `src/server/orchestrator/orchestrator.test.ts`
- Create: `src/server/orchestrator/orchestrator.ts`

- [ ] **Step 1: Write failing orchestrator test**

Create `src/server/orchestrator/orchestrator.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { RepositoryStore } from "../repositories/repositoryStore.js";
import type { AgentAdapter } from "../services/agentAdapter.js";
import type { CreatedWorktree, WorktreeManager } from "../services/worktreeManager.js";
import type { QualityGate } from "../quality/qualityGate.js";
import type { ReviewGate } from "../review/reviewGate.js";
import { Orchestrator } from "./orchestrator.js";

describe("Orchestrator", () => {
  it("runs a queued task through pushed state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-orchestrator-"));
    const db = openDatabase(join(dir, "state.sqlite"));
    const store = new RepositoryStore(db.sql);
    const project = store.createProject("agent-fleet");
    const repository = store.createRepository({
      projectId: project.id,
      name: "agent-fleet",
      rootPath: dir,
      remoteUrl: "https://github.com/ikingye/agent-fleet",
      mainBranch: "main"
    });
    const task = store.createTask({
      repositoryId: repository.id,
      title: "Add dashboard",
      goal: "Build dashboard",
      source: "local",
      sourceUrl: null
    });
    const worktreeManager = {
      async createWorktree(): Promise<CreatedWorktree> {
        return {
          repositoryId: repository.id,
          taskId: task.id,
          path: join(dir, ".worktrees", task.id),
          branch: "agent-fleet/task-1-add-dashboard",
          baseCommit: "abc123"
        };
      },
      async mergeToMain() {
        return undefined;
      }
    } as WorktreeManager;
    const adapter: AgentAdapter = {
      kind: "codex",
      async detect() {
        return { available: true, version: "codex-cli 0.125.0", message: "ok" };
      },
      async start(input) {
        return { kind: "codex", status: "succeeded", output: "done", logPath: input.logPath };
      }
    };
    const qualityGate = {
      async run() {
        return { passed: true, checks: [] };
      }
    } as unknown as QualityGate;
    const reviewGate = {
      async run() {
        return { passed: true, summary: "APPROVED" };
      }
    } as unknown as ReviewGate;

    const orchestrator = new Orchestrator({ store, worktreeManager, adapter, qualityGate, reviewGate });
    await orchestrator.runNext();

    expect(store.getTask(task.id)?.state).toBe("pushed");
    expect(store.listTaskEvents(task.id).map((event) => event.state)).toContain("agent_running");
    expect(store.listTaskEvents(task.id).map((event) => event.state)).toContain("pushed");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Implement orchestrator**

Create `src/server/orchestrator/orchestrator.ts`:

```ts
import { join } from "node:path";
import type { RepositoryStore } from "../repositories/repositoryStore.js";
import type { AgentAdapter } from "../services/agentAdapter.js";
import type { WorktreeManager } from "../services/worktreeManager.js";
import type { QualityGate } from "../quality/qualityGate.js";
import type { ReviewGate } from "../review/reviewGate.js";

interface OrchestratorDependencies {
  store: RepositoryStore;
  worktreeManager: WorktreeManager;
  adapter: AgentAdapter;
  qualityGate: QualityGate;
  reviewGate: ReviewGate;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async runNext(): Promise<boolean> {
    const [task] = this.deps.store.listQueuedTasks(1);
    if (!task) {
      return false;
    }

    const repository = this.deps.store.getRepository(task.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${task.repositoryId} not found`);
    }

    this.deps.store.transitionTask(task.id, "planned", "orchestrator", "Task planned", {
      adapter: this.deps.adapter.kind
    });

    const worktree = await this.deps.worktreeManager.createWorktree({
      repositoryId: repository.id,
      repositoryRoot: repository.rootPath,
      mainBranch: repository.mainBranch,
      taskId: task.id,
      taskTitle: task.title
    });
    this.deps.store.transitionTask(task.id, "worktree_ready", "orchestrator", "Worktree ready", worktree);

    const prompt = [
      `Task: ${task.title}`,
      "",
      task.goal,
      "",
      "Work in this worktree only. Make focused changes. Run relevant tests before final response."
    ].join("\n");

    this.deps.store.transitionTask(task.id, "agent_running", "orchestrator", "Codex worker started", {
      worktreePath: worktree.path
    });
    const run = await this.deps.adapter.start({
      taskId: task.id,
      worktreePath: worktree.path,
      prompt,
      logPath: join(repository.rootPath, ".agent-fleet", "logs", `${task.id}.log`)
    });
    if (run.status !== "succeeded") {
      this.deps.store.transitionTask(task.id, "failed", "worker", "Worker failed", { output: run.output });
      return true;
    }

    this.deps.store.transitionTask(task.id, "changes_ready", "worker", "Worker completed changes", {
      logPath: run.logPath
    });

    this.deps.store.transitionTask(task.id, "checks_running", "quality_gate", "Quality gate started", {});
    const quality = await this.deps.qualityGate.run({
      taskId: task.id,
      repositoryRoot: worktree.path,
      commands: [
        { name: "typecheck", command: "npm run typecheck" },
        { name: "unit", command: "npm run test" }
      ]
    });
    if (!quality.passed) {
      this.deps.store.transitionTask(task.id, "blocked", "quality_gate", "Quality gate failed", {
        checks: quality.checks
      });
      return true;
    }

    this.deps.store.transitionTask(task.id, "reviewing", "reviewer", "Review gate started", {});
    const review = await this.deps.reviewGate.run({
      taskId: task.id,
      worktreePath: worktree.path,
      goal: task.goal,
      logRoot: join(repository.rootPath, ".agent-fleet", "logs")
    });
    if (!review.passed) {
      this.deps.store.transitionTask(task.id, "blocked", "reviewer", "Review requested changes", {
        summary: review.summary
      });
      return true;
    }

    this.deps.store.transitionTask(task.id, "reviewing", "reviewer", "Review gate passed", {
      summary: review.summary
    });
    this.deps.store.transitionTask(task.id, "merge_ready", "orchestrator", "Task ready to merge", {});

    await this.deps.worktreeManager.mergeToMain({
      repositoryRoot: repository.rootPath,
      mainBranch: repository.mainBranch,
      branch: worktree.branch,
      message: `merge: ${task.title}`
    });

    this.deps.store.transitionTask(task.id, "merged", "orchestrator", "Merged to main", { branch: worktree.branch });
    this.deps.store.transitionTask(task.id, "pushed", "orchestrator", "Pushed main to origin", {
      remoteUrl: repository.remoteUrl
    });
    return true;
  }
}
```

- [ ] **Step 3: Verify orchestrator**

Run:

```bash
npm test -- src/server/orchestrator/orchestrator.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 4: Commit**

```bash
git add src/server/orchestrator
git commit -m "feat: add autonomous task orchestrator"
```

## Task 10: API Routes for Dashboard, Task Creation, and Issue Import

**Files:**
- Create: `src/server/config/paths.ts`
- Create: `src/server/routes/routes.test.ts`
- Create: `src/server/routes/routes.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Add local path config**

Create `src/server/config/paths.ts`:

```ts
import { resolve } from "node:path";

export function getStateDatabasePath() {
  return resolve(process.env.AGENT_FLEET_DB ?? ".agent-fleet/agent-fleet.sqlite");
}
```

- [ ] **Step 2: Write failing route tests**

Create `src/server/routes/routes.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("API routes", () => {
  it("registers a repository and creates a local task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-routes-"));
    const app = createApp({ databasePath: join(dir, "state.sqlite") });

    const register = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        projectName: "agent-fleet",
        name: "agent-fleet",
        rootPath: dir,
        remoteUrl: "https://github.com/ikingye/agent-fleet",
        mainBranch: "main"
      }
    });
    const repository = register.json();

    const create = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        repositoryId: repository.id,
        title: "Add route",
        goal: "Build task route"
      }
    });
    const list = await app.inject({ method: "GET", url: "/api/dashboard" });

    expect(create.statusCode).toBe(200);
    expect(list.json().tasks).toHaveLength(1);

    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Implement routes**

Create `src/server/routes/routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { openDatabase } from "../db/database.js";
import { GitHubClient } from "../github/githubClient.js";
import { RepositoryStore } from "../repositories/repositoryStore.js";
import { createCommandRunner } from "../services/commandRunner.js";

export interface RouteOptions {
  databasePath: string;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export async function registerRoutes(app: FastifyInstance, options: RouteOptions) {
  const db = openDatabase(options.databasePath);
  const store = new RepositoryStore(db.sql);
  const github = new GitHubClient(createCommandRunner());

  app.addHook("onClose", async () => {
    db.close();
  });

  app.get("/api/dashboard", async () => {
    return {
      repositories: store.listRepositories(),
      tasks: store.listTasks()
    };
  });

  app.post("/api/repositories", async (request) => {
    const body = request.body as Record<string, unknown>;
    const project = store.createProject(requireString(body.projectName, "projectName"));
    return store.createRepository({
      projectId: project.id,
      name: requireString(body.name, "name"),
      rootPath: requireString(body.rootPath, "rootPath"),
      remoteUrl: typeof body.remoteUrl === "string" && body.remoteUrl.trim() ? body.remoteUrl.trim() : null,
      mainBranch: requireString(body.mainBranch, "mainBranch")
    });
  });

  app.post("/api/tasks", async (request) => {
    const body = request.body as Record<string, unknown>;
    return store.createTask({
      repositoryId: requireString(body.repositoryId, "repositoryId"),
      title: requireString(body.title, "title"),
      goal: requireString(body.goal, "goal"),
      source: "local",
      sourceUrl: null
    });
  });

  app.post("/api/github/issues/import", async (request) => {
    const body = request.body as Record<string, unknown>;
    const issue = await github.getIssue(requireString(body.githubRepository, "githubRepository"), Number(body.issueNumber));
    return store.createTask({
      repositoryId: requireString(body.repositoryId, "repositoryId"),
      title: issue.title,
      goal: issue.goal,
      source: "github_issue",
      sourceUrl: issue.url
    });
  });
}
```

Modify `src/server/app.ts`:

```ts
import fastify from "fastify";
import cors from "@fastify/cors";
import { getStateDatabasePath } from "./config/paths.js";
import { registerRoutes } from "./routes/routes.js";

export interface AppOptions {
  databasePath?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/api/health", async () => {
    return { ok: true, service: "agent-fleet" };
  });

  app.register(registerRoutes, {
    databasePath: options.databasePath ?? getStateDatabasePath()
  });

  return app;
}
```

- [ ] **Step 4: Verify routes**

Run:

```bash
npm test -- src/server/app.test.ts src/server/routes/routes.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/config src/server/routes src/server/app.ts
git commit -m "feat: expose dashboard and task api"
```

## Task 11: Web Console Dashboard

**Files:**
- Create: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Create client API helper**

Create `src/client/api.ts`:

```ts
import type { Repository, Task } from "../shared/types.js";

export interface DashboardData {
  repositories: Repository[];
  tasks: Task[];
}

export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    throw new Error(`Dashboard request failed: ${response.status}`);
  }
  return (await response.json()) as DashboardData;
}

export async function createTask(input: { repositoryId: string; title: string; goal: string }): Promise<Task> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Create task failed: ${response.status}`);
  }
  return (await response.json()) as Task;
}
```

- [ ] **Step 2: Replace app shell with dashboard**

Modify `src/client/App.tsx`:

```tsx
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { DashboardData } from "./api.js";
import { createTask, fetchDashboard } from "./api.js";

export function App() {
  const [dashboard, setDashboard] = useState<DashboardData>({ repositories: [], tasks: [] });
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeRepository = useMemo(() => dashboard.repositories[0] ?? null, [dashboard.repositories]);

  async function refresh() {
    setDashboard(await fetchDashboard());
  }

  useEffect(() => {
    refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    if (!activeRepository) {
      setError("Register a repository before creating tasks.");
      return;
    }
    await createTask({ repositoryId: activeRepository.id, title, goal });
    setTitle("");
    setGoal("");
    await refresh();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local Orchestrator</p>
          <h1>agent-fleet</h1>
        </div>
        <button className="secondary-button" onClick={() => refresh().catch(console.error)}>
          Refresh
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="dashboard-grid">
        <aside className="panel">
          <h2>Projects</h2>
          {dashboard.repositories.length === 0 ? (
            <p className="muted">No repositories registered yet.</p>
          ) : (
            dashboard.repositories.map((repository) => (
              <div className="repo-row" key={repository.id}>
                <strong>{repository.name}</strong>
                <span>{repository.rootPath}</span>
              </div>
            ))
          )}
        </aside>

        <section className="panel task-panel">
          <div className="panel-header">
            <h2>Task Queue</h2>
            <span>{dashboard.tasks.length} tasks</span>
          </div>
          <form className="task-form" onSubmit={submitTask}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" />
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Goal and acceptance criteria" />
            <button type="submit">Queue task</button>
          </form>
          <div className="task-list">
            {dashboard.tasks.map((task) => (
              <article className="task-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.goal}</p>
                </div>
                <span className={`state state-${task.state}`}>{task.state}</span>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel">
          <h2>Active Run</h2>
          <p className="muted">The first active Codex run will appear after orchestrator execution is wired to the dashboard.</p>
        </aside>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Replace CSS with dashboard layout**

Modify `src/client/styles.css`:

```css
:root {
  color: #182026;
  background: #f5f7f8;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid #d8dee3;
  background: #ffffff;
}

.eyebrow {
  margin: 0 0 4px;
  color: #56616b;
  font-size: 12px;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

.secondary-button,
.task-form button {
  border: 1px solid #1d4f73;
  border-radius: 6px;
  background: #1d4f73;
  color: #ffffff;
  padding: 8px 12px;
  cursor: pointer;
}

.secondary-button {
  background: #ffffff;
  color: #1d4f73;
}

.error-banner {
  margin: 16px 24px 0;
  border: 1px solid #b42318;
  border-radius: 6px;
  background: #fff1f0;
  color: #7a271a;
  padding: 10px 12px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 320px;
  gap: 16px;
  padding: 20px 24px;
}

.panel {
  min-width: 0;
  border: 1px solid #d8dee3;
  border-radius: 8px;
  background: #ffffff;
  padding: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.muted {
  color: #69747d;
}

.repo-row,
.task-row {
  border-top: 1px solid #edf0f2;
  padding: 12px 0;
}

.repo-row span {
  display: block;
  color: #69747d;
  font-size: 13px;
  word-break: break-all;
}

.task-form {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.task-form input,
.task-form textarea {
  width: 100%;
  border: 1px solid #c8d0d6;
  border-radius: 6px;
  padding: 9px 10px;
}

.task-form textarea {
  min-height: 90px;
  resize: vertical;
}

.task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}

.task-row p {
  margin-bottom: 0;
  color: #56616b;
}

.state {
  align-self: start;
  border-radius: 999px;
  background: #edf7ed;
  color: #245b2a;
  padding: 4px 8px;
  font-size: 12px;
}

@media (max-width: 980px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Verify web console**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit with status `0`.

- [ ] **Step 5: Commit**

```bash
git add src/client
git commit -m "feat: add local fleet dashboard"
```

## Task 12: Playwright Smoke Test and CI

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/dashboard.spec.ts`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
```

- [ ] **Step 2: Add e2e dashboard smoke test**

Create `tests/e2e/dashboard.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("dashboard renders the local command center", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "agent-fleet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Task Queue" })).toBeVisible();
  await expect(page.getByPlaceholder("Task title")).toBeVisible();
});
```

- [ ] **Step 3: Add GitHub Actions workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run build
```

- [ ] **Step 4: Verify checks locally**

Run:

```bash
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Expected: all commands exit with status `0`.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e .github/workflows/ci.yml
git commit -m "test: add e2e smoke test and ci"
```

## Task 13: Local Repo Registration and First Autonomous Run Wiring

**Files:**
- Modify: `src/server/routes/routes.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/routes/routes.test.ts`

- [ ] **Step 1: Add run-once route test**

Append this test to `src/server/routes/routes.test.ts`:

```ts
  it("exposes an orchestrator run-once endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-fleet-run-"));
    const app = createApp({ databasePath: join(dir, "state.sqlite") });

    const response = await app.inject({ method: "POST", url: "/api/orchestrator/run-once" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ran: false });

    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Wire orchestrator dependencies into routes**

Modify `src/server/routes/routes.ts` to import runtime dependencies:

```ts
import { CodexAdapter } from "../services/codexAdapter.js";
import { WorktreeManager } from "../services/worktreeManager.js";
import { QualityGate } from "../quality/qualityGate.js";
import { ReviewGate } from "../review/reviewGate.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
```

Inside `registerRoutes`, replace the earlier `const github = new GitHubClient(createCommandRunner());` line with this shared runner block:

```ts
  const runner = createCommandRunner();
  const github = new GitHubClient(runner);
  const codexAdapter = new CodexAdapter(runner);
  const orchestrator = new Orchestrator({
    store,
    worktreeManager: new WorktreeManager(runner),
    adapter: codexAdapter,
    qualityGate: new QualityGate(runner),
    reviewGate: new ReviewGate(codexAdapter)
  });
```

Add this route:

```ts
  app.post("/api/orchestrator/run-once", async () => {
    const ran = await orchestrator.runNext();
    return { ran };
  });
```

- [ ] **Step 3: Verify orchestrator route**

Run:

```bash
npm test -- src/server/routes/routes.test.ts
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/routes.ts src/server/routes/routes.test.ts
git commit -m "feat: expose orchestrator run endpoint"
```

## Task 14: Repository Creation, Private Remote, and Push

**Files:**
- Modify: no source files unless verification exposes a defect.

- [ ] **Step 1: Verify GitHub authentication**

Run:

```bash
gh auth status
```

Expected: authenticated account can access `github.com`.

- [ ] **Step 2: Create or connect private repository**

Run:

```bash
gh repo view ikingye/agent-fleet --json nameWithOwner,visibility
```

If the repo does not exist, run:

```bash
gh repo create ikingye/agent-fleet --private --source=. --remote=origin
```

If the repo exists and no `origin` remote exists, run:

```bash
git remote add origin git@github.com:ikingye/agent-fleet.git
```

If `origin` exists with a different URL, run:

```bash
git remote set-url origin git@github.com:ikingye/agent-fleet.git
```

- [ ] **Step 3: Push main**

Run:

```bash
git push -u origin main
```

Expected: push succeeds and GitHub repository visibility is private.

- [ ] **Step 4: Verify final local state**

Run:

```bash
git status --short --ignored
git log --oneline -5
```

Expected: no uncommitted tracked files. Ignored local runtime directories may appear with `!!`.

## References Used for Planning

- Git worktree official documentation: https://git-scm.com/docs/git-worktree.html
- Node SQLite documentation: https://nodejs.org/api/sqlite.html
- Vite create-vite package documentation: https://www.npmjs.com/package/create-vite
- Fastify TypeScript documentation: https://fastify.dev/docs/latest/Reference/TypeScript/
- Vitest documentation: https://vitest.dev/
- Playwright installation documentation: https://playwright.dev/docs/intro
- OpenAI Codex CLI README: https://github.com/openai/codex/blob/main/codex-rs/README.md
