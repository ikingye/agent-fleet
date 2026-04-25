# macOS Remote Offload

Use this mode when local macOS CPU must stay cool and agent-fleet should run builds, tests, worktrees,
and worker agents on a Linux server.

## Recommended MVP Topology

Run one full agent-fleet instance on each remote server:

- macOS runs only the browser, SSH tunnels, and the local proxy.
- The remote server runs Node, git, Codex CLI, builds, tests, worktrees, and orchestration.
- The browser opens the remote web UI through an SSH `LocalForward`.

This keeps repeated TypeScript builds, Playwright, and agent worker processes off the laptop.

## SSH Config

Example:

```sshconfig
Host remote-dev
    HostName 203.0.113.10
    User ubuntu
    IdentityFile ~/.ssh/agent_fleet_remote
    Port 22
    RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

The `RemoteForward` makes the macOS proxy available on the remote host at `127.0.0.1:1080`.
For this setup the local proxy is HTTP CONNECT compatible, so use `http://127.0.0.1:1080`.

## Proxy Policy

Do not proxy all traffic by default.

- Use direct remote access for mainland-reachable services such as npm and OS package mirrors.
- Use the forwarded proxy only for blocked or unstable domains such as GitHub API, Google, or OpenAI.
- Prefer per-command environment variables:

```bash
HTTPS_PROXY=http://127.0.0.1:1080 HTTP_PROXY=http://127.0.0.1:1080 \
  curl -I https://api.github.com/rate_limit
```

## Local Browser Tunnel

Expose the remote web UI to macOS:

```bash
ssh -fN -S none -o ControlMaster=no -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8788:127.0.0.1:8787 remote-dev
```

Open:

```text
http://127.0.0.1:8788
```

## Readiness Checks

agent-fleet can register remote execution nodes and run checks for:

- SSH config readability.
- `RemoteForward 127.0.0.1:1080` presence when proxy fallback is enabled.
- SSH connectivity.
- Remote `git`, `node`, and `codex` availability.
- Direct npm registry access.
- Direct GitHub API access.
- GitHub API access through the forwarded proxy.

When the full agent-fleet instance itself runs on the remote server, these checks are mainly for adding
additional remote nodes. The current server's own readiness can be checked directly with shell commands
on that server.
