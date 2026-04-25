# agent-fleet MVP Design

Date: 2026-04-25

## Summary

agent-fleet is a local macOS-first control plane for autonomous software development agents. Its core purpose is to let an orchestrator agent manage other coding agents so the user supplies goals while the system handles project execution: task planning, git worktree creation, child agent runs, review, tests, merge, push, and status visualization.

The MVP proves this by self-bootstrapping on the `agent-fleet` repository itself. The first real agent adapter is Codex. Claude Code and Gemini CLI are future adapters behind the same interface.

## Goals

- Run locally on one macOS machine.
- Provide a local web console for multi-project and task progress visibility.
- Let the orchestrator, not the human, manage `git worktree` operations.
- Support local web task creation and GitHub issue import.
- Spawn Codex child agents in isolated worktrees.
- Persist enough state to stop, resume, audit, and recover task execution.
- Automatically run available quality gates before merging.
- Automatically merge and push to `main` when checks and review pass.
- Keep the final repository private at `github.com/ikingye/agent-fleet`.
- Maintain a disciplined `.gitignore` so local state, worktrees, logs, secrets, dependencies, and generated artifacts are not committed.

## Non-Goals

- No distributed workers in the MVP.
- No cloud-hosted control plane.
- No multi-user auth or team permissions.
- No first-class Claude Code or Gemini CLI implementation in the first adapter pass.
- No broad "one vague strategic goal creates many repos" automation in the MVP.

## Chosen Approach

Use **Local Orchestrator + Worker Processes**.

The system runs as one local TypeScript application with:

- a web console,
- an API server,
- SQLite persistent state,
- a local orchestrator loop,
- a worktree manager,
- an agent adapter layer,
- a quality gate runner,
- and GitHub integration.

This is preferred over a distributed worker runtime because the first constraint is proving the autonomous development loop on a single Mac. It is also preferred over a GitHub-native runtime because interactive CLI agents and local worktrees need direct local process control.

## System Architecture

### Web Console

The web console is a command center, not the primary operator of worktrees.

It shows:

- registered projects and repositories,
- local tasks and imported GitHub issues,
- active agent runs,
- worktree paths and branches,
- task timelines,
- logs and summaries,
- checks, reviews, merge attempts, and push status.

It supports:

- creating a local task,
- importing a GitHub issue into the local queue,
- pausing, resuming, or stopping a task when needed,
- viewing task detail and agent logs,
- configuring repo registration, agent CLI paths, concurrency limits, quality commands, GitHub auth status, and auto-merge policy.

### Orchestrator

The orchestrator is the central autonomous agent.

It owns:

- task intake,
- task planning,
- implementation strategy selection,
- worktree allocation,
- child agent assignment,
- progress monitoring,
- retry decisions,
- quality gate routing,
- review routing,
- merge and push decisions,
- cleanup after successful completion,
- escalation when human input is required.

The orchestrator should search official documentation and best practices when technical implementation choices are unclear. It should ask the user only when product intent, requirements, permissions, or irreversible operations are unclear.

### Worktree Manager

The worktree manager wraps `git worktree` and isolates all branch/worktree lifecycle operations.

Responsibilities:

- create task branches and linked worktrees,
- list and reconcile known worktrees,
- detect dirty or missing worktrees,
- associate a task with branch, path, and base commit,
- merge successful task branches back to `main`,
- prune or remove completed worktrees after merge verification,
- avoid deleting unmanaged paths.

Git worktrees are the correct primitive because Git supports multiple working trees attached to one repository, allowing more than one branch to be checked out at the same time.

### Agent Adapter Layer

The adapter layer gives every coding agent the same contract.

Initial interface shape:

- `detect()`: verify CLI availability, version, and auth hints.
- `start(task, worktree, prompt)`: launch a worker run.
- `status(runId)`: return current state.
- `streamLogs(runId)`: expose log output to the UI and orchestrator.
- `resume(runId)`: resume a paused or interrupted session when the adapter supports it.
- `stop(runId)`: request stop.
- `summarize(runId)`: produce a compact result summary.

MVP adapter:

- `CodexAdapter`.

Future adapters:

- `ClaudeCodeAdapter`.
- `GeminiCliAdapter`.

Codex is suitable for MVP automation because Codex CLI supports non-interactive execution through `codex exec`, and Codex CLI can be configured for sandbox and automation-oriented usage.

### Quality Gate

The quality gate runs before auto-merge.

Gate categories:

- format,
- lint,
- unit tests,
- integration tests,
- e2e tests,
- code review.

Commands come from repo config. If a category is not available yet, the gate records it as unavailable and uses the strongest available checks. As the repository matures, gates should become stricter.

Review is a separate agent pass that prioritizes defects, regressions, missing tests, and risky behavior changes. Review findings trigger one automatic fix attempt before escalation.

### GitHub Integration

GitHub integration supports:

- validating GitHub auth,
- registering `github.com/ikingye/agent-fleet`,
- importing issues into the local task queue,
- pushing successful merges to `main`,
- closing linked issues after push,
- future pull request workflows if the repo policy changes.

The MVP is allowed to push directly to `main` after local quality gates and review pass. GitHub Actions can later provide a remote safety net using workflow files. Merge queue is a later option if the repository moves to an organization plan that supports the needed private-repo queue features.

## Persistent State

Use SQLite plus append-only task events.

Core tables:

- `projects`
- `repositories`
- `tasks`
- `task_events`
- `worktrees`
- `agent_runs`
- `checks`
- `reviews`
- `merge_attempts`

Raw child agent logs should live as files under `.agent-fleet/`, with paths and compact summaries stored in SQLite. This keeps SQLite inspectable and avoids unbounded log growth.

## Task Lifecycle

Primary states:

1. `queued`
2. `planned`
3. `worktree_ready`
4. `agent_running`
5. `changes_ready`
6. `checks_running`
7. `reviewing`
8. `merge_ready`
9. `merged`
10. `pushed`

Exception states:

- `blocked`
- `needs_clarification`
- `retrying`
- `failed`

Each transition writes a `task_event` with timestamp, actor, state, command summary, and relevant file/log references.

## Autonomy Policy

The default policy is autonomous execution.

The orchestrator may automatically:

- create branches and worktrees,
- spawn Codex worker runs,
- search official docs and best practices,
- choose technical implementation approaches,
- run quality checks,
- launch review workers,
- ask workers to fix check or review failures,
- merge to `main`,
- push to GitHub,
- close linked GitHub issues.

The orchestrator should ask the user only when:

- the product goal is ambiguous,
- requirements conflict,
- an external secret or paid account is missing,
- a destructive operation would affect paths outside a managed repository,
- repeated failures exceed the retry budget,
- review finds unresolved product tradeoffs,
- GitHub auth or permission blocks push.

## Retry Policy

- One automatic fix attempt for formatting, lint, or test failures.
- One automatic fix attempt for review findings.
- Escalate to `blocked` or `needs_clarification` after repeated failure.
- Never delete unmanaged paths during cleanup.
- Keep completed worktrees until merge and push are verified.

## MVP Demo

The first end-to-end demo is self-development:

1. Register the current `agent-fleet` repo.
2. Create a local task from the web console.
3. Orchestrator plans the task.
4. Worktree manager creates a task worktree and branch.
5. CodexAdapter launches a Codex worker in that worktree.
6. Orchestrator monitors run status and logs.
7. Worker completes changes.
8. Quality gate runs available checks.
9. Review pass runs and any required fix loop is attempted.
10. Orchestrator merges to `main`.
11. Orchestrator pushes to `github.com/ikingye/agent-fleet`.
12. Dashboard shows the full timeline and final pushed state.

## Technology Choices

- TypeScript for the application.
- Node.js runtime.
- Local web app with an API server.
- SQLite for durable local state.
- Git CLI for worktree and merge operations.
- Codex CLI for the first worker adapter.
- GitHub CLI or GitHub API for auth, issue import, and push-related integration.
- Playwright for future web e2e tests once the web app exists.

The implementation plan should decide the exact web framework after checking current ecosystem fit and repo constraints. Since this is a local app with a dashboard, a conservative default is Vite + React + a small Node API server unless implementation research finds a better fit.

## Repository Hygiene

The repository must ignore:

- `.agent-fleet/`
- `.worktrees/`
- `.superpowers/`
- dependency folders,
- build outputs,
- coverage and test reports,
- logs,
- temp files,
- local `.env` files,
- OS/editor noise.

An `.env.example` may be committed later for documented configuration.

## References

- Git worktree official documentation: https://git-scm.com/docs/git-worktree.html
- GitHub Actions workflow syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub merge queue documentation: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- OpenAI Codex CLI Rust implementation README: https://github.com/openai/codex/blob/main/codex-rs/README.md
- OpenAI developers Codex documentation index: https://developers.openai.com/
