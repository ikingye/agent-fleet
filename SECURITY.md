# Security Policy

agent-fleet is private-incubation software. Treat all issues as sensitive until the project owner decides otherwise.

## Reporting

Report security concerns privately to the repository owner. Do not open public issues containing:

- API keys, tokens, cookies, or credentials.
- Private repository names or paths.
- Private hostnames, IPs, SSH config details, or proxy endpoints.
- Raw Worker Agent transcripts containing secrets.

## Supported Version

Only the current `main` branch is supported during private incubation.

## Security Expectations

- Keep `.env`, `.agent-fleet/`, logs, worktrees, and local state out of git.
- Redact Worker output before sharing it.
- Prefer least-privilege remote execution credentials.
- Make proxy behavior explicit and domain-aware.
- Review agent-generated code before merging.

Dependency review is configured for pull requests through GitHub Actions.
