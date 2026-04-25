# Getting Started

This guide runs agent-fleet on one machine. For remote offload, see
[remote/macos-offload.md](remote/macos-offload.md).

## Install

```bash
git clone https://github.com/ikingye/agent-fleet.git
cd agent-fleet
npm ci
npm run build
```

## Start

```bash
AGENT_FLEET_HOST=127.0.0.1 AGENT_FLEET_PORT=8787 npm start
```

Open:

```text
http://127.0.0.1:8787
```

## Add a Repository

Use the API while the UI repository onboarding flow is still early:

```bash
curl -X POST http://127.0.0.1:8787/api/repositories \
  -H 'Content-Type: application/json' \
  -d '{
    "projectName": "Example",
    "name": "example-repo",
    "rootPath": "/absolute/path/to/example-repo",
    "remoteUrl": "https://github.com/example/example-repo.git",
    "mainBranch": "main"
  }'
```

## Queue a Task

```bash
curl -X POST http://127.0.0.1:8787/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "repositoryId": "<repository-id>",
    "title": "Add health endpoint",
    "goal": "Implement the endpoint, add tests, and keep existing checks green."
  }'
```

Run one orchestrator cycle:

```bash
curl -X POST http://127.0.0.1:8787/api/orchestrator/run-once
```

## Run Checks

```bash
npm run check
npm run build
```

For e2e tests on a new Linux machine:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```
