# Contributing

Contributions are welcome. Keep changes focused, tested, and consistent with the current architecture.

## Before You Start

1. Search existing issues and pull requests.
2. Open an issue for large behavior changes, new agent adapters, or orchestration architecture changes.
3. Keep credentials, local state, generated files, and worktrees out of commits.

## Development Setup

```bash
git clone https://github.com/ikingye/agent-fleet.git
cd agent-fleet
npm ci
npm run check
npm run build
```

Optional e2e setup:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

## Branches

Use short, descriptive branches:

```bash
git checkout -b feature/remote-worker-runner
```

For work that touches orchestration, worktree management, command execution, or review gates, prefer a
git worktree so concurrent agent work stays isolated.

## Pull Request Expectations

- Explain the user-visible change.
- Include tests for behavior changes.
- Run `npm run check` and `npm run build`.
- Run `npm run test:e2e` for UI or server routing changes.
- Keep unrelated refactors out of the PR.
- Document new environment variables, commands, or workflows.

## Architecture Guidelines

- Prefer small services with explicit interfaces.
- Keep command execution wrapped behind `CommandRunner`.
- Keep agent-specific behavior inside adapter classes.
- Keep git worktree logic centralized.
- Do not proxy all remote traffic by default; proxy only domains that need fallback.
- Treat agent output as untrusted until checks and review gates pass.

## Commit Style

Use concise conventional-style subjects when possible:

```text
feat: add remote worker runner
fix: handle missing codex binary
docs: explain remote proxy fallback
test: cover worktree merge conflicts
```
