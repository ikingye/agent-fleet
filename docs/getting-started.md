# Getting Started

## 1. Install

```sh
npm ci
```

## 2. Configure A Worker Command

By default agent-fleet uses `codexyoloproxy`.

You can point to another command:

```sh
AGENT_FLEET_WORKER_COMMAND=codexyoloproxy
AGENT_FLEET_WORKER_CWD=/Users/you/code/project/agent-fleet
```

The command can be a real executable on PATH or a zsh alias loaded by an interactive shell.

## 3. Start The App

```sh
npm run dev
```

Open the Vite URL and submit a goal. The Steward will record a decision and try to start a Worker session.

## 4. Review The Dashboard

Use the dashboard to inspect:

- Goals and status.
- Steward decisions.
- Worker command, pid, resume id, status, and initial output.
- Human corrections and learned memory.
