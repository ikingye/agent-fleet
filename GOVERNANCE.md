# Governance

agent-fleet is currently maintained by the repository owner with community input through issues and
pull requests.

## Decision Making

Maintainers prioritize:

1. Local and remote machine safety.
2. Reliable git worktree isolation.
3. Clear quality gates before merge and push.
4. Agent adapter boundaries that make Codex, Claude Code, Gemini CLI, and future agents replaceable.
5. Practical workflows over speculative platform features.

Large changes should start as an issue or design discussion before implementation.

## Maintainer Responsibilities

- Keep `main` passing CI.
- Review security-sensitive changes carefully.
- Avoid merging generated or agent-written code without tests and review.
- Keep public documentation free of private infrastructure details.
- Label and close issues with clear rationale.
