# Architecture

agent-fleet is split into a web client, API server, SQLite control plane, and service adapters.

## Runtime Components

- **React client**: dashboard for repositories, tasks, and remote nodes.
- **Fastify server**: local HTTP API and static web serving.
- **SQLite database**: projects, repositories, tasks, events, worktrees, agent runs, checks, reviews,
  merge attempts, and remote hosts.
- **CommandRunner**: the boundary for local shell commands.
- **WorktreeManager**: creates git worktrees and merges completed branches.
- **Agent adapters**: encapsulate worker CLIs. Codex is implemented first.
- **QualityGate**: runs project checks.
- **ReviewGate**: asks an agent reviewer to inspect changes before merge.
- **RemoteHostProbe**: checks SSH and proxy readiness for remote execution nodes.

## Current Execution Model

The current stable path is:

1. Run agent-fleet locally or run the full instance on a remote server.
2. Register repositories.
3. Queue tasks.
4. The orchestrator creates a git worktree from the repository root.
5. Codex executes in the worktree.
6. Quality and review gates run.
7. Merge and push flow can proceed after gates pass.

Remote hosts are currently registered and probed for readiness. The full remote worker scheduler is a
roadmap item.

## Safety Boundaries

- Runtime state stays under `.agent-fleet/`.
- Worktrees stay under `.worktrees/`.
- Command execution is wrapped by `CommandRunner`.
- Agent-specific behavior stays inside adapters.
- Remote proxy fallback is explicit; direct traffic remains direct by default.

## Data Flow

```text
Browser -> Fastify routes -> RepositoryStore -> SQLite
                         -> Orchestrator -> WorktreeManager -> git
                                       -> AgentAdapter -> Codex CLI
                                       -> QualityGate -> npm/test commands
                                       -> ReviewGate -> reviewer agent
```
