# Security Policy

agent-fleet executes shell commands, manages git worktrees, runs agent CLIs, and may connect to remote
servers. Treat every deployment as a developer tool with access to source code and local credentials.

## Supported Versions

Security fixes target the latest `main` branch until the project starts publishing versioned releases.

## Reporting a Vulnerability

Do not open a public issue for vulnerabilities.

Until a private security advisory channel is configured for the public repository, report sensitive
issues to the maintainer through GitHub private contact channels. Include:

- Affected commit or version.
- Reproduction steps.
- Impact.
- Whether credentials, source code, or remote machines can be exposed.

## Sensitive Data Rules

Never commit:

- API keys or model provider tokens.
- SSH private keys.
- `.agent-fleet/` runtime state.
- `.env` files.
- Worktrees under `.worktrees/`.
- Logs containing prompts, repository contents, credentials, or machine addresses.
- Real private server IPs or hostnames in examples.

## Threat Model

High-risk areas include:

- Prompt injection through issue text, task goals, or repository files.
- Shell command execution by worker agents.
- Accidental merge or push of unreviewed agent output.
- Proxy configuration that leaks all traffic through an unintended endpoint.
- Remote execution nodes with overly broad SSH privileges.

Security-sensitive changes should include tests and a clear explanation of the expected boundary.
