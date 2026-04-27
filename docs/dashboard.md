# Web Dashboard

The dashboard is the compact owner-facing control plane. It is not a business project UI and should not host product-specific application screens.

## Primary Jobs

Use the dashboard to:

- Chat with the Steward.
- Submit goals with an explicit Target directory.
- Review Steward decisions, risks, confidence, reversibility, and double-check needs.
- Correct decisions and memory.
- Inspect goal status and Worker reports.
- Review remote nodes, worktrees, events, recovery, and durable memory.

## Owner-Facing Priority

The owner should see Steward-level state first:

1. What goal is being handled.
2. What the Steward decided.
3. What risks or blockers need owner action.
4. What was verified.
5. What happens next.

Worker messages, stdout/stderr, command lines, resume mechanics, and detailed protocol output are audit/debug data. Keep them collapsed or secondary unless they create an owner decision.

## Steward Chat

Steward Chat is durable product state. Messages are stored in `stewardMessages` and can be recovered after a restart.

Chat messages should include or inherit:

- `workspacePath`.
- `projectName`.
- Optional related goal id.
- Transport metadata such as `web`, `cli`, or `webhook`.

## Steward Intake

Steward Intake turns owner goals into durable control-plane records. The Target directory should be the project that owns the work.

For normal product work:

```text
~/code/project/example-app
```

For control-plane work:

```text
~/code/project/agent-fleet
```

Only use the agent-fleet workspace when the owner explicitly asks to modify agent-fleet.

## Decisions And Corrections

Decision review should make important choices auditable. A useful decision record answers:

- What action did the Steward choose?
- Why was that action appropriate?
- What risk level does it carry?
- How confident is the Steward?
- Is the action reversible?
- Does it need human review or an independent double-check?

Corrections should improve future Steward behavior. Prefer correcting a decision, preference, or memory over editing low-level Worker transcript details.

## Worker Session Details

Worker details are still durable and inspectable. They should include:

- Worker Name.
- Worker kind.
- cwd or remote workspace path.
- Host id for remote sessions.
- pid when available.
- resume id when available.
- status and recent output.
- structured final report when available.

Expose these details for audit, debugging, and recovery, but do not make the owner manage raw terminal sessions as the normal workflow.

## Recovery Panel

After a restart or compacted Steward session, review recovery before dispatching more work. The recovery surface should show active goals, active Worker sessions, resume commands, latest checkpoint, worktree metadata, and next actions.
