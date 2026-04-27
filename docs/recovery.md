# Recovery And State

Recovery is a core product feature. agent-fleet should survive terminal disconnects, compacted Steward sessions, server restarts, and interrupted Worker sessions with enough durable state to continue deliberately.

## Durable State

The default local state file is:

```text
.agent-fleet/control-plane.json
```

It can contain:

- Goals.
- Steward Chat messages in `stewardMessages`.
- Decisions.
- Corrections.
- Memory.
- Worker sessions.
- Worker reports.
- Resume ids.
- Checkpoints.
- Execution nodes.
- Worktree assignments.
- Events.
- GitHub deploy-key leases.

`.agent-fleet/` is ignored by git and must not be committed.

## Recovery Endpoint

Use:

```sh
curl http://127.0.0.1:8787/api/recovery
```

The recovery report derives:

- Active goal ids.
- Active Worker sessions.
- Resume commands when available.
- Latest Steward checkpoint.
- Planned or materialized worktrees.
- Recommended next actions.

## Restart Checklist

After a terminal disconnect, machine restart, or compacted Steward context:

1. Start the API and dashboard.
2. Fetch `GET /api/recovery`.
3. Review active Worker sessions and resume ids.
4. Inspect latest checkpoint and next actions.
5. Route updates to existing relevant Workers when possible.
6. Dispatch a new Worker only after confirming no active session already owns the work.

## Steward Checkpoints

Steward checkpoints are append-only notes that preserve coordinator context:

- Reason.
- Summary.
- Next action.
- Related goal or Worker session ids.

Checkpoints should not duplicate all process metadata. Worker sessions and worktree records remain the source of truth for execution state.

## Worker Session Reconciliation

Worker session lifecycle is durable state, not terminal state. A supervisor can reconcile recorded sessions by probing the execution environment and updating status through the same store path.

Typical outcomes:

- `running` remains `running` when the process is alive.
- `running` becomes `paused` when the process is missing and a resume id exists.
- `running` becomes `failed` when the process is missing and no resume path exists.
- Remote sessions are probed through their registered SSH node.

## What Recovery Does Not Do Yet

v0.1.0 recovery is inspectable and useful, but not a hardened distributed supervisor. It does not yet provide:

- Multi-user conflict resolution.
- Automatic merge decisions.
- Guaranteed remote cleanup for every failure mode.
- Database-backed event querying.
- Full process control across heterogeneous hosts.

Those are roadmap items. The v0.1.0 requirement is that recovery state is durable, inspectable, and honest about next actions.
