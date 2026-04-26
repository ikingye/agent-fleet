# Contributing

agent-fleet is private for now, but contributions should follow the same standard expected from a public project.

## Before You Start

- Read [README.md](README.md), [AGENTS.md](AGENTS.md), and [docs/architecture.md](docs/architecture.md).
- Keep the Steward Agent / Worker Agent vocabulary consistent.
- Do not include credentials, private hostnames, private IPs, terminal transcripts with secrets, or local `.agent-fleet` state in commits.

## Development Setup

```sh
npm ci
npm run check
npm run build
```

Use `npm run dev` for local API + web development.

## Pull Request Standard

A PR should include:

- A focused summary of the user-facing or developer-facing change.
- Tests for changed behavior.
- Documentation updates when setup, architecture, or workflows change.
- Verification output for `npm run check` and `npm run build`.

## Design Standard

agent-fleet is an operational control plane, not a marketing site. UI work should prioritize scanability, decision review, correction workflows, and multi-project supervision.

## Commit Hygiene

Keep unrelated refactors out of feature changes. If a structural cleanup is needed, make it explicit and keep behavior stable.
