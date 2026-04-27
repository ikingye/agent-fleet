# agent-fleet Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build agent-fleet into a private but public-ready Steward Agent control plane that can supervise Worker Agents across projects, sessions, worktrees, and remote execution nodes.

**Architecture:** Keep the Steward Agent as the single orchestration authority. Preserve explicit module boundaries: HTTP routes compose services, the Steward records decisions and dispatches work, stores persist control-plane facts, Worker adapters encapsulate process execution, and future remote/worktree schedulers remain testable domain modules.

**Tech Stack:** TypeScript, Node.js 24, Fastify, React, Vite, Vitest, zsh-compatible Worker command launching.

---

## File Map

- `src/shared/types.ts`: shared serializable domain records.
- `src/server/http/createApp.ts`: API composition and route registration.
- `src/server/store/jsonControlPlaneStore.ts`: JSON-backed control-plane persistence.
- `src/server/steward/stewardRuntime.ts`: goal acceptance, decision recording, correction handling, and dispatch policy.
- `src/server/workers/commandWorkerAdapter.ts`: local Worker command launch and resume-id extraction.
- `src/server/worktrees/worktreeManager.ts`: worktree path planning and command generation.
- `src/server/remote/proxyPolicy.ts`: domain-aware direct/proxy decision rules.
- `src/server/remote/remoteNodeRegistry.ts`: remote execution node records and readiness decisions.
- `src/client/App.tsx`: dashboard workflow for supervision, correction, Worker sessions, and remote/worktree state.

## Task 1: Worktree Planning Domain

**Files:**
- Create: `src/server/worktrees/worktreeManager.test.ts`
- Create: `src/server/worktrees/worktreeManager.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/worktrees/worktreeManager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planWorktree } from "./worktreeManager.js";

describe("planWorktree", () => {
  it("creates deterministic branch and path metadata for a Worker assignment", () => {
    const result = planWorktree({
      projectName: "agent-fleet",
      repositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      goalTitle: "Add remote execution",
      workerSessionId: "worker-123"
    });

    expect(result).toEqual({
      branchName: "agent-fleet/worker-123-add-remote-execution",
      path: "/repo/agent-fleet/.worktrees/worker-123-add-remote-execution",
      command: "git worktree add /repo/agent-fleet/.worktrees/worker-123-add-remote-execution -b agent-fleet/worker-123-add-remote-execution"
    });
  });

  it("normalizes unsafe names without producing empty branch segments", () => {
    const result = planWorktree({
      projectName: "Agent Fleet!",
      repositoryPath: "/repo/agent-fleet",
      worktreeRoot: "/repo/agent-fleet/.worktrees",
      goalTitle: "修复 Google proxy & resume_id",
      workerSessionId: "worker_ABC"
    });

    expect(result.branchName).toBe("agent-fleet/worker-abc-google-proxy-resume-id");
    expect(result.path).toBe("/repo/agent-fleet/.worktrees/worker-abc-google-proxy-resume-id");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```sh
npx vitest run src/server/worktrees/worktreeManager.test.ts
```

Expected: fail because `src/server/worktrees/worktreeManager.ts` does not exist.

- [ ] **Step 3: Implement minimal worktree planner**

Create `src/server/worktrees/worktreeManager.ts`:

```ts
import { join } from "node:path";

export interface PlanWorktreeInput {
  projectName: string;
  repositoryPath: string;
  worktreeRoot: string;
  goalTitle: string;
  workerSessionId: string;
}

export interface PlannedWorktree {
  branchName: string;
  path: string;
  command: string;
}

export function planWorktree(input: PlanWorktreeInput): PlannedWorktree {
  const projectSlug = slug(input.projectName);
  const workerSlug = slug(input.workerSessionId);
  const goalSlug = slug(input.goalTitle);
  const worktreeName = `${workerSlug}-${goalSlug}`;
  const path = join(input.worktreeRoot, worktreeName);
  const branchName = `${projectSlug}/${worktreeName}`;

  return {
    branchName,
    path,
    command: `git worktree add ${path} -b ${branchName}`
  };
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, "-")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized === "" ? "untitled" : normalized;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```sh
npx vitest run src/server/worktrees/worktreeManager.test.ts
```

Expected: pass.

- [ ] **Step 5: Add shared type**

Modify `src/shared/types.ts` with:

```ts
export interface WorktreeAssignment {
  id: string;
  workerSessionId: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  status: "planned" | "active" | "merged" | "abandoned";
  createdAt: string;
  updatedAt: string;
}
```

Then add `worktreeAssignments: WorktreeAssignment[]` to `DashboardData`.

- [ ] **Step 6: Run related checks**

Run:

```sh
npx vitest run src/server/worktrees/worktreeManager.test.ts
npm run typecheck
```

Expected: all pass.

## Task 2: Resume Command Domain

**Files:**
- Create: `src/server/workers/resumeCommand.test.ts`
- Create: `src/server/workers/resumeCommand.ts`
- Modify: `src/server/steward/stewardRuntime.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/workers/resumeCommand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildResumeCommand } from "./resumeCommand.js";

describe("buildResumeCommand", () => {
  it("builds Codex resume commands from Worker session metadata", () => {
    expect(
      buildResumeCommand({
        kind: "codex",
        baseCommand: "codexyoloproxy",
        resumeId: "resume-42"
      })
    ).toBe("codexyoloproxy resume resume-42");
  });

  it("returns null when there is no resume id", () => {
    expect(
      buildResumeCommand({
        kind: "codex",
        baseCommand: "codexyoloproxy",
        resumeId: null
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```sh
npx vitest run src/server/workers/resumeCommand.test.ts
```

Expected: fail because `resumeCommand.ts` does not exist.

- [ ] **Step 3: Implement resume command builder**

Create `src/server/workers/resumeCommand.ts`:

```ts
import type { WorkerKind } from "../../shared/types.js";

export interface BuildResumeCommandInput {
  kind: WorkerKind;
  baseCommand: string;
  resumeId: string | null;
}

export function buildResumeCommand(input: BuildResumeCommandInput): string | null {
  if (input.resumeId === null || input.resumeId.trim() === "") {
    return null;
  }

  if (input.kind === "codex") {
    return `${input.baseCommand} resume ${shellArg(input.resumeId)}`;
  }

  return `${input.baseCommand} resume ${shellArg(input.resumeId)}`;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```sh
npx vitest run src/server/workers/resumeCommand.test.ts
npm run typecheck
```

Expected: pass.

## Task 3: Remote Proxy Policy Domain

**Files:**
- Create: `src/server/remote/proxyPolicy.test.ts`
- Create: `src/server/remote/proxyPolicy.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/remote/proxyPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseNetworkRoute } from "./proxyPolicy.js";

describe("chooseNetworkRoute", () => {
  it("uses direct routing for mainland domains", () => {
    expect(
      chooseNetworkRoute({
        hostname: "baidu.com",
        proxyUrl: "http://127.0.0.1:1080"
      })
    ).toEqual({ mode: "direct", proxyUrl: null, reason: "domain is configured for direct remote access" });
  });

  it("uses the forwarded proxy for blocked global domains", () => {
    expect(
      chooseNetworkRoute({
        hostname: "google.com",
        proxyUrl: "http://127.0.0.1:1080"
      })
    ).toEqual({ mode: "proxy", proxyUrl: "http://127.0.0.1:1080", reason: "domain is configured for proxy fallback" });
  });

  it("uses direct routing when no proxy is configured", () => {
    expect(chooseNetworkRoute({ hostname: "github.com", proxyUrl: null })).toEqual({
      mode: "direct",
      proxyUrl: null,
      reason: "no proxy configured"
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```sh
npx vitest run src/server/remote/proxyPolicy.test.ts
```

Expected: fail because `proxyPolicy.ts` does not exist.

- [ ] **Step 3: Implement proxy policy**

Create `src/server/remote/proxyPolicy.ts`:

```ts
export interface ChooseNetworkRouteInput {
  hostname: string;
  proxyUrl: string | null;
}

export interface NetworkRoute {
  mode: "direct" | "proxy";
  proxyUrl: string | null;
  reason: string;
}

const DIRECT_DOMAINS = ["baidu.com", "bilibili.com", "qq.com", "taobao.com", "tmall.com", "zhihu.com"];
const PROXY_DOMAINS = ["google.com", "youtube.com", "openai.com", "anthropic.com", "x.com", "twitter.com"];

export function chooseNetworkRoute(input: ChooseNetworkRouteInput): NetworkRoute {
  const hostname = input.hostname.toLowerCase();

  if (matches(hostname, DIRECT_DOMAINS)) {
    return { mode: "direct", proxyUrl: null, reason: "domain is configured for direct remote access" };
  }

  if (input.proxyUrl === null || input.proxyUrl.trim() === "") {
    return { mode: "direct", proxyUrl: null, reason: "no proxy configured" };
  }

  if (matches(hostname, PROXY_DOMAINS)) {
    return { mode: "proxy", proxyUrl: input.proxyUrl, reason: "domain is configured for proxy fallback" };
  }

  return { mode: "direct", proxyUrl: null, reason: "default direct route" };
}

function matches(hostname: string, domains: string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```sh
npx vitest run src/server/remote/proxyPolicy.test.ts
npm run typecheck
```

Expected: pass.

## Task 4: Dashboard Supervision UI

**Files:**
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Write the failing UI test**

Add to `src/client/App.test.tsx`:

```tsx
it("shows supervision metrics for decisions, Worker sessions, and memory", async () => {
  render(<App />);

  expect(await screen.findByText("Human Review")).toBeInTheDocument();
  expect(await screen.findByText("Running Workers")).toBeInTheDocument();
  expect(await screen.findByText("Memory Items")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run:

```sh
npx vitest run src/client/App.test.tsx
```

Expected: fail until the dashboard exposes those metric labels.

- [ ] **Step 3: Implement the metrics strip**

Modify `src/client/App.tsx` to compute:

```ts
const humanReviewCount = dashboard.decisions.filter((decision) => decision.needsHumanReview).length;
const runningWorkerCount = dashboard.workerSessions.filter((session) => session.status === "running").length;
const memoryCount = dashboard.memories.length;
```

Render metric labels `Human Review`, `Running Workers`, and `Memory Items` above the main dashboard columns.

- [ ] **Step 4: Style the metrics strip**

Modify `src/client/styles.css` so the metrics use a compact responsive grid:

```css
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```sh
npx vitest run src/client/App.test.tsx
npm run typecheck
```

Expected: pass.

## Final Integration

- [ ] Run `npm run check`.
- [ ] Run `npm run build`.
- [ ] Inspect `git status --short`.
- [ ] Update `README.md` and `ROADMAP.md` if the implemented feature set changed.
- [ ] Keep `package.json` private until the owner explicitly opens the repository.
