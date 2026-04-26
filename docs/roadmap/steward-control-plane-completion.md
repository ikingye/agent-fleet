# Steward Control Plane Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P0 gaps between the current local control-plane slice and a complete Steward control plane that can accept owner goals, decide, dispatch or route Worker Agents, ingest Worker outcomes, use memory in future decisions, reconcile remote execution, and recover after restarts.

**Architecture:** Keep the Steward Agent as the owner-facing orchestrator. HTTP routes compose durable store operations and Steward runtimes; Worker adapters encapsulate process/SSH execution; remote servers remain stateless compute resources; owner-facing UI foregrounds Steward decisions and recovery while Worker protocol detail stays secondary audit data.

**Tech Stack:** TypeScript, Node.js 24, Fastify, React, Vite, Vitest, JSON control-plane store, local process Worker adapter, SSH remote Worker adapter.

---

## Current Confirmed Baseline

- `src/server/steward/stewardRuntime.ts` accepts explicit `workspacePath` goals, records a dispatch decision, selects local or remote placement from execution node readiness/capacity, provisions remote git workspace, starts a Worker adapter, records Worker sessions, worktree metadata, and checkpoints.
- `src/server/steward/supervisorRuntime.ts` reconciles starting/running local Worker sessions through an injected process probe, marking stale resumable sessions `paused`.
- `src/server/steward/recoveryRuntime.ts` builds recovery reports from durable dashboard state, including active goals, active Worker sessions, resume commands, worktrees, recent Steward messages, and next actions.
- `src/server/http/createApp.ts` exposes goals, dashboard, recovery, local reconcile, manual autonomy reconcile, Steward messages, decision corrections, Worker status updates, checkpoints, and execution node registration.
- `src/server/store/jsonControlPlaneStore.ts` persists goals, decisions, Worker sessions, corrections, memory, execution nodes, worktrees, checkpoints, Steward Chat messages, artifacts, reviews, delivery reports, and events.
- `src/client/App.tsx` shows compact dashboard tabs, Steward Chat, intake, key decisions/corrections, active Worker summary, debug disclosures, recovery/resources views, and memory counts.

## P0 Gaps To Close

1. Steward loop: `/api/steward/messages` returns a deterministic status summary, and `/api/steward/autonomy/run` only reconciles local sessions. There is no durable loop that decides whether to dispatch, wait, resume, ask the owner, or ingest completed work.
2. Worker final report ingestion: completed Worker output remains `lastOutput`; structured final reports are not parsed into artifacts, reviews, delivery reports, decisions, memory, or follow-up actions.
3. Remote lifecycle: remote Worker sessions are excluded from reconcile, remote readiness is static registration-time validation, and remote resume/probe behavior is not durable enough for restart recovery.
4. Memory retrieval: corrections create memory, but Steward dispatch/chat decisions do not retrieve relevant user/project memory and do not include it in rationale or Worker prompts.
5. UI/API polish: the dashboard has the right surfaces, but it lacks direct controls/results for Steward run outcomes, Worker report ingestion state, remote readiness/reconcile state, and memory used in a decision.
6. Final verification: there is no end-to-end acceptance pass that demonstrates goal intake through dispatch, completion ingestion, decision review, memory reuse, remote fallback/readiness, and recovery.

## Work Packages And Write Scopes

### 1. Steward Loop Runtime

**Worker name:** `agent-fleet-steward-loop-runtime-202604262155`

**Recommended placement:** local for focused runtime work; use remote only if running the full test/build loop repeatedly.

**Write scope:**

- `src/server/steward/stewardLoopRuntime.ts`
- `src/server/steward/stewardLoopRuntime.test.ts`
- Narrow edits to `src/server/http/createApp.ts`
- Narrow edits to `src/shared/types.ts`
- Narrow edits to `src/server/store/jsonControlPlaneStore.ts`

**Do not touch:** Worker adapters, remote workspace provisioning, React layout except type fallout.

**Required behavior:**

- Add a Steward loop operation that loads dashboard state and records a durable run result/checkpoint.
- Decide one of: `dispatch_goal`, `wait_for_workers`, `resume_worker`, `ingest_worker_report`, `ask_owner`, `no_action`.
- Dispatch only queued goals or blocked goals explicitly made actionable by state; do not spawn duplicate Workers for goals with active sessions.
- Keep owner-facing rationale in `StewardDecision`; low-level probe/output detail stays in events or Worker session metadata.
- Preserve `workspacePath` as the normal project selector.

**Acceptance criteria:**

- Unit tests cover no active work, queued goal dispatch, active Worker wait, paused Worker resume recommendation, completed Worker report ingestion recommendation, and duplicate-dispatch prevention.
- `POST /api/steward/autonomy/run` returns the loop decision/run result and records a checkpoint; it no longer only reports local reconcile.
- Existing local reconcile behavior remains available through `/api/recovery/reconcile`.

**Verification commands:**

```sh
npx vitest run src/server/steward/stewardLoopRuntime.test.ts src/server/http/createApp.test.ts
npm run typecheck
```

### 2. Worker Structured Final Report Ingestion

**Worker name:** `agent-fleet-worker-report-ingestion-remote-202604262156`

**Recommended placement:** remote. This package is likely long/high-load because it touches store contracts, parsing, route tests, and integration fixtures.

**Write scope:**

- `src/server/workers/finalReport.ts`
- `src/server/workers/finalReport.test.ts`
- Narrow edits to `src/server/steward/stewardRuntime.ts`
- Narrow edits to `src/server/steward/stewardLoopRuntime.ts` after package 1 lands
- Narrow edits to `src/server/store/jsonControlPlaneStore.ts`
- Narrow edits to `src/shared/types.ts`
- Narrow edits to `src/server/http/createApp.ts`

**Do not touch:** SSH command construction, remote node readiness policy, major UI restructuring.

**Required behavior:**

- Define a strict, minimal final report schema in plain text/Markdown that Workers can produce:
  - exact Worker Name heading
  - `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`
  - `Changed files:`
  - `Verification:`
  - `Risks:`
  - optional `Next steps:`
- Parse final reports from Worker completion output or from a dedicated ingestion endpoint.
- Reject or flag reports whose heading does not match the expected Worker Name.
- Record parsed output as durable artifacts/reviews/delivery reports using existing store concepts where possible.
- Update goal status from parsed report status: `DONE` -> `completed`, `DONE_WITH_CONCERNS` or `BLOCKED` -> `blocked`.
- Record a Steward decision for owner-visible risks and required double-checks.

**Acceptance criteria:**

- Tests cover valid report ingestion, missing heading, blocked report, verification extraction, risk surfacing, and idempotent re-ingestion for the same Worker session.
- Worker prompt includes the exact report format expected by the parser.
- Dashboard/recovery can inspect report-derived artifacts and delivery reports from durable state.

**Verification commands:**

```sh
npx vitest run src/server/workers/finalReport.test.ts src/server/steward/stewardRuntime.test.ts src/server/http/createApp.test.ts
npm run typecheck
```

### 3. Remote Lifecycle, Readiness, And Resume

**Worker name:** `agent-fleet-remote-lifecycle-resume-remote-202604262157`

**Recommended placement:** remote. This package owns remote execution lifecycle and should be run away from the local Mac when doing repeated SSH/provisioning simulations.

**Write scope:**

- `src/server/remote/remoteLifecycleRuntime.ts`
- `src/server/remote/remoteLifecycleRuntime.test.ts`
- Narrow edits to `src/server/remote/remoteNodeReadiness.ts`
- Narrow edits to `src/server/workers/sshWorkerAdapter.ts`
- Narrow edits to `src/server/steward/supervisorRuntime.ts`
- Narrow edits to `src/server/steward/recoveryRuntime.ts`
- Narrow edits to `src/server/http/createApp.ts`
- Narrow edits to `src/shared/types.ts`

**Do not touch:** local command adapter behavior unless a shared interface change requires it; final report parser.

**Required behavior:**

- Add a remote reconcile path with injected SSH/remote probe runner; do not make remote servers stateful.
- Derive readiness from live probe results plus registered node facts, and persist node status/events after reconcile.
- For remote Worker sessions, distinguish running, completed, failed, missing-with-resume, and missing-without-resume.
- Recovery reports must show remote host/node, remote cwd, resume command, and whether the next action is probe, resume, or ask owner.
- Keep remote fallback auditable when no ready matching node exists.

**Acceptance criteria:**

- Tests cover ready node probe success, offline node update, remote Worker running, remote Worker missing with resume -> `paused`, remote Worker missing without resume -> `failed`, and recovery next actions.
- `/api/recovery/reconcile` or a new scoped endpoint can reconcile both local and remote sessions without shelling directly in route handlers.
- Remote servers are still treated as stateless compute; all durable lifecycle truth remains in local control-plane state.

**Verification commands:**

```sh
npx vitest run src/server/remote/remoteLifecycleRuntime.test.ts src/server/steward/supervisorRuntime.test.ts src/server/steward/recoveryRuntime.test.ts src/server/http/createApp.test.ts
npm run typecheck
```

### 4. Memory Retrieval Into Steward Decisions

**Worker name:** `agent-fleet-memory-aware-decisions-202604262158`

**Recommended placement:** local unless paired with full-suite verification.

**Write scope:**

- `src/server/steward/memoryRetrieval.ts`
- `src/server/steward/memoryRetrieval.test.ts`
- Narrow edits to `src/server/steward/stewardRuntime.ts`
- Narrow edits to `src/server/steward/stewardLoopRuntime.ts`
- Narrow edits to `src/server/http/createApp.ts`
- Narrow edits to `src/server/store/jsonControlPlaneStore.ts`
- Narrow edits to `src/shared/types.ts`

**Do not touch:** UI styling, Worker adapters, remote provisioning.

**Required behavior:**

- Retrieve relevant user-scope and matching project-scope memories for a goal/chat/loop decision.
- Include memory references in Steward decision rationale/actions and Worker prompts without leaking unrelated projects.
- Record which memory ids were used in a decision or event.
- Keep correction-created memory durable and updateable.

**Acceptance criteria:**

- Tests cover user memory retrieval, project memory filtering, irrelevant memory exclusion, prompt inclusion, and decision/event audit of used memory ids.
- A correction submitted through the API affects a later dispatch decision or Worker prompt.

**Verification commands:**

```sh
npx vitest run src/server/steward/memoryRetrieval.test.ts src/server/steward/stewardRuntime.test.ts src/server/http/createApp.test.ts
npm run typecheck
```

### 5. UI And API Polish

**Worker name:** `agent-fleet-control-plane-ui-api-polish-202604262159`

**Recommended placement:** local for UI iteration; use remote if running repeated full build/test passes.

**Write scope:**

- `src/client/App.tsx`
- `src/client/api.ts`
- `src/client/styles.css`
- `src/client/App.test.tsx`
- Narrow edits to `src/server/http/createApp.ts` only for response shapes needed by UI
- Narrow edits to `src/shared/types.ts`

**Do not touch:** Steward loop internals, final report parser, remote probe implementation.

**Required behavior:**

- Surface Steward loop/autonomy run result as a primary owner-facing control-plane action.
- Show Worker final report status and key risks without exposing raw output by default.
- Show remote node readiness/reconcile status and remote capacity/fallback decisions.
- Show memory used by decisions in a compact audit view.
- Keep Worker command lines, stdout/stderr, resume mechanics, and protocol details collapsed by default.

**Acceptance criteria:**

- UI tests cover Steward run button/result, hidden Worker debug detail, report-derived risk display, remote readiness state, and memory-used display.
- No business project UI is embedded in agent-fleet.
- Text remains compact and does not introduce older terms such as "butler agent" or "task agent".

**Verification commands:**

```sh
npx vitest run src/client/App.test.tsx src/server/http/createApp.test.ts
npm run typecheck
npm run build
```

### 6. Final Verification And Documentation Refresh

**Worker name:** `agent-fleet-final-verification-remote-202604262200`

**Recommended placement:** remote. This package is intentionally high-load because it runs the full suite/build and end-to-end smoke checks.

**Write scope:**

- `docs/architecture.md`
- `docs/configuration.md`
- `docs/development.md`
- `README.md`
- Test fixtures or scripts only if required for repeatable verification

**Do not touch:** product/runtime code except tiny fixes explicitly required by failed verification and coordinated with the owning Worker scope.

**Required behavior:**

- Update docs to describe implemented behavior only.
- Run full repository verification.
- Produce a final integration report with exact commands, pass/fail output summary, residual risks, and manual smoke steps.

**Acceptance criteria:**

- `npm run check` passes.
- `npm run build` passes.
- A smoke test demonstrates: goal with `workspacePath` -> Steward decision -> Worker session -> completed/blocked final report ingestion -> key decision/risk visible -> recovery report contains next action -> memory correction influences later decision.
- Remote smoke uses fake/injected SSH runner unless a real remote node is intentionally configured by the owner.

**Verification commands:**

```sh
npm run check
npm run build
git diff --check
```

## Integration Order

1. Land Steward Loop Runtime first; it becomes the coordinator that the other packages plug into.
2. Land Worker Structured Final Report Ingestion second; the loop needs report-derived facts to continue beyond a completed Worker process.
3. Land Remote Lifecycle third; it extends the same loop/recovery semantics to stateless remote compute.
4. Land Memory Retrieval fourth; after the loop and ingestion records exist, memory can influence concrete decisions and prompts.
5. Land UI/API Polish fifth; the owner-facing dashboard should expose the stable backend contracts, not chase moving shapes.
6. Run Final Verification last on remote capacity and refresh docs to match only what is implemented.

## Cross-Package Contracts

- Worker Name is the source of truth. Every Worker prompt starts with `Worker Name: ...`, and final reports must use that exact name as the heading.
- `workspacePath` is required for new goals and is the normal target project selector. `AGENT_FLEET_WORKER_CWD` remains only a fallback.
- Important Steward decisions remain durable and correctable. Worker chatter remains audit/debug detail unless it creates a blocker, risk, or owner action.
- Remote servers remain stateless. Local durable state owns goals, decisions, Worker sessions, resume ids, worktrees, events, memory, and recovery.
- Implementation Workers must not overlap write scopes unless the Program Lead or Steward explicitly resequences them.
