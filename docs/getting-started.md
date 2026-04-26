# Getting Started

## 1. Install

```sh
npm ci
```

## 2. Configure A Worker Command

By default agent-fleet uses `codexyoloproxy`.

The Worker command is launched by the API, so a real executable on PATH is more reliable than an interactive shell alias. The server reads `AGENT_FLEET_WORKER_COMMAND` and `AGENT_FLEET_WORKER_ARGS`; zsh aliases are supported by the adapter, but aliases can be fragile without a TTY.

```sh
AGENT_FLEET_WORKER_COMMAND=codexyoloproxy
```

For real Codex Worker sessions, prefer noninteractive execution:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

`codexyoloproxy` is mainly for interactive terminal use and can fail for API-launched Workers with `stdin is not a terminal`.

Do not use Worker cwd as the project selector. Each goal must include a target `workspacePath`, shown in the dashboard as Target directory. For normal product work, set that path to the business project workspace, such as `~/code/project/mahjong`. Use the agent-fleet workspace only when the owner explicitly asks to change the control plane itself.

## 3. Start The App

```sh
cd ~/code/project/agent-fleet
npm run dev
```

Open the Vite URL, chat with the Steward, and submit goals through Steward Intake. The Steward records a decision and tries to start a Worker session in the target workspace.

Default local URLs:

- Web app: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

Use Steward Chat as the owner's primary interaction surface. Chat messages are persisted as `stewardMessages` in `.agent-fleet/control-plane.json`. Include or select the target `workspacePath` so the Steward can keep project state, Worker cwd, decisions, corrections, and resume information scoped to the right workspace.

## 4. Review The Dashboard

Use the dashboard to inspect:

- Goals and status.
- Steward decisions.
- Worker command, pid, resume id, status, and initial output.
- Human corrections and learned memory.
- Remote nodes, planned worktrees, audit events, and Steward Chat history.

The dashboard is for compact management and review. Do not add business project UI or product-specific implementation to agent-fleet; keep that code in the target workspace.

## 5. Recover After Restart

agent-fleet stores local control-plane state at `.agent-fleet/control-plane.json` by default.

After a terminal disconnect, compacted Steward session, or computer restart:

```sh
npm run dev
curl http://127.0.0.1:8787/api/recovery
```

Use the recovery report to review active goals, active Worker sessions, resume commands, latest checkpoint, and next actions before dispatching more work.
