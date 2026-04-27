# Steward/Worker Model

agent-fleet is designed around a hard delegation boundary: the Steward coordinates; Workers execute.

## Delegation Boundary

The Steward Agent owns owner-facing orchestration:

- Accept owner instructions from web, CLI, or connector transports.
- Decide whether a goal is ready for Worker dispatch.
- Record rationale, risk, confidence, reversibility, and double-check requirements.
- Route new instructions to a new Worker or an existing relevant Worker.
- Keep durable state compact enough to resume after terminal or context loss.

Worker Agents own concrete work:

- Read code, docs, logs, and project files.
- Implement changes.
- Run verification.
- Review or merge when explicitly assigned as a review/merge Worker.
- Clean merged branches and worktrees when safe.
- Audit remote sessions and process status.
- Report status, changed files, verification, decisions, blockers, and next actions.

The Steward may communicate Worker-reported verification, but source-of-truth verification comes from the responsible Worker. High-impact or low-confidence changes should get independent Worker verification.

## Goal Workspace

Each owner goal must carry an explicit target `workspacePath`.

For normal product work, use the business project workspace:

```sh
~/code/project/example-app
```

Use the agent-fleet workspace only when the owner explicitly asks to modify agent-fleet itself.

`AGENT_FLEET_WORKER_CWD` is only a fallback for launch paths that do not receive a goal workspace. It is not the normal project selector.

## Worker Naming

Every Worker task must have a human-readable Worker Name:

```text
<project-name>-<worker-purpose>-YYYYMMDDHHmm
```

Remote or high-load Workers include `remote` before the timestamp:

```text
<project-name>-<worker-purpose>-remote-YYYYMMDDHHmm
```

Examples:

```text
agent-fleet-docs-site-202604271220
agent-fleet-worker-completion-backend-remote-202604261738
example-app-project-readiness-202604261652
```

The Steward puts the Worker Name at the top of the Worker prompt and requires the Worker final report to use that exact name as its heading. Random spawn nicknames are secondary.

## Decision Review

Owner-facing review should emphasize Steward decisions:

- What the Steward chose.
- Why it chose that path.
- Risk and confidence.
- Whether the action is reversible.
- Whether a double-check is required.
- What the owner needs to decide.

Raw Worker messages, stdout/stderr, command lines, resume mechanics, and protocol output remain durable audit/debug information. They should be collapsed or secondary unless they create a blocker, failed verification, high-impact risk, or ambiguous instruction.

## Corrections And Memory

Corrections should target Steward decisions and learned preferences rather than low-level Worker chatter. When a Worker transcript reveals a process problem, translate it into a Steward decision correction or memory entry so the next orchestration improves.

## Review And Cleanup

Review/merge Workers, not the Steward, own merge readiness and cleanup. They may delete branches and worktrees only after the work has been merged into `main` or `master` and verified safe to remove.

Blocked or unmerged branches and worktrees must be retained with an explicit blocker reason and owner.
