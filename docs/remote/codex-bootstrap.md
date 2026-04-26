# Remote Codex Bootstrap

Remote Codex Workers run on disposable compute nodes. Treat the remote host as a replaceable executor: install runtime tools, authenticate Codex explicitly, let agent-fleet prepare a scratch workspace from git, run the Worker, and keep durable state in agent-fleet plus git.

## Readiness Probe

Use read-only probes before changing a remote node:

```sh
ssh aicp-hhht-231 '
  command -v codex || true
  codex --version 2>&1 || true
  codex --help 2>&1 | sed -n "1,120p" || true
  codex login --help 2>&1 | sed -n "1,120p" || true
  codex login status 2>&1 || true
  command -v node || true
  node --version 2>&1 || true
  command -v npm || true
  npm --version 2>&1 || true
  (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep "127.0.0.1:1080" || true
  command -v nvidia-smi && nvidia-smi -L || true
'
```

For Codex authentication metadata, list files only. Do not print token contents:

```sh
ssh aicp-hhht-231 '
  for d in "$HOME/.codex" "$HOME/.config/codex" "$HOME/.local/share/codex"; do
    [ -e "$d" ] && { echo "$d"; ls -la "$d"; }
  done
'
```

On macOS, Codex CLI auth and config commonly live under `~/.codex`. The desktop app also keeps browser profile data under `~/Library/Application Support/codex`. Do not copy either location to a remote host without explicit owner approval.

## Installing Codex CLI

If `command -v codex` fails but Node and npm are available, install the CLI without changing broad system configuration:

```sh
ssh aicp-hhht-231 'npm install -g @openai/codex'
```

If Node is missing, bootstrap Node first through the host's normal package manager or prebuilt runtime image, then rerun the Codex install. Record the exact install command and resulting `codex --version` in the node audit notes.

## Authentication Options

Prefer an explicit remote login over copying local credentials.

### Browser Callback Forwarding

`codex login --help` supports normal browser login, `--device-auth`, and `--with-api-key`. On the probed Codex CLI, normal login started a local callback server on port `1455`.

For browser login from macOS to a remote server, open SSH with local forwarding from the Mac to the remote callback port:

```sh
ssh -L 127.0.0.1:1455:127.0.0.1:1455 aicp-hhht-231
```

Then run this inside that SSH session:

```sh
codex login
```

Open the printed login URL in the macOS browser. The browser callback to `127.0.0.1:1455` will be forwarded to the remote Codex login server. Do not automate this in agent-fleet; it requires owner browser interaction.

### Device Auth

For headless hosts, Codex also advertises:

```sh
codex login --device-auth
```

Use this when the browser callback flow is unreliable or a callback port cannot be forwarded. It still requires owner action in a browser.

### API Key

For service-style workers, Codex can read an API key from stdin:

```sh
printenv OPENAI_API_KEY | codex login --with-api-key
```

Only use this when the owner has approved key handling for the remote host. Do not log the key, echo it, or persist it outside Codex's auth flow.

### Credential Copy

Copying `~/.codex/auth.json` from macOS to a remote host may be plausible because the CLI stores login state under `~/.codex`, but it is a secret-bearing file and may be tied to local installation details. Treat copying as a break-glass operation only:

```sh
# Only after explicit owner approval.
scp ~/.codex/auth.json aicp-hhht-231:~/.codex/auth.json
ssh aicp-hhht-231 'chmod 600 ~/.codex/auth.json && codex login status'
```

Never include auth file contents in logs, Worker prompts, dashboard events, or final reports.

## Proxy Forwarding

For remote hosts that need the Mac's local proxy for overseas domains, configure SSH remote forwarding:

```sshconfig
Host aicp-hhht-231
  HostName 1.180.13.251
  User root
  Port 231
  RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

Verify that the forwarded listener exists on the remote:

```sh
ssh aicp-hhht-231 '
  (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep "127.0.0.1:1080"
  command -v nc >/dev/null 2>&1 && nc -vz -w 2 127.0.0.1 1080 || true
'
```

When registering the execution node, set `proxyUrl` to the remote-visible forwarded proxy URL:

```json
{
  "name": "aicp-hhht-231",
  "kind": "remote",
  "status": "ready",
  "sshHost": "aicp-hhht-231",
  "workRoot": "/root/agent-fleet-workspaces",
  "proxyUrl": "http://127.0.0.1:1080",
  "tags": ["remote", "linux", "china-network", "high-cpu"],
  "capacity": 2
}
```

agent-fleet passes proxy environment variables to remote Worker commands when `proxyUrl` is set:

```text
ALL_PROXY=http://127.0.0.1:1080
HTTP_PROXY=http://127.0.0.1:1080
HTTPS_PROXY=http://127.0.0.1:1080
NO_PROXY=localhost,127.0.0.1
```

Use the domain-aware proxy policy for higher-level routing decisions. Direct-capable mainland traffic should not be forced through the forwarded proxy by default.

## Workspace Provisioning

agent-fleet prepares remote workspaces conservatively before launching Codex:

- The remote cwd is created if missing.
- Git is the preferred sync mechanism. The local target workspace must be inside a git repository with `remote.origin.url`.
- The remote checkout is scratch/cache. Do not rely on unpushed remote files as durable state.
- Local uncommitted files are not copied, and agent-fleet does not push commits.
- Codex auth, API keys, SSH keys, and other secrets are not copied as part of workspace provisioning.
- Non-empty remote directories that are not git checkouts block provisioning instead of being deleted.

If provisioning blocks, fix the source-of-truth issue first: add a git origin, push required commits, authenticate the remote host to fetch that origin, or choose a local Worker for work that depends on uncommitted local state.

## Current `aicp-hhht-231` Probe

As of 2026-04-26:

- Codex CLI is installed at `/usr/local/bin/codex`.
- Remote Codex version is `0.125.0`.
- Node is installed at `/usr/local/bin/node`, version `v24.15.0`.
- npm is installed at `/usr/local/bin/npm`, version `11.12.1`.
- `@openai/codex@0.125.0` is installed globally under `/opt/node-v24/lib`.
- `codex login status` reports `Not logged in`.
- `~/.codex` exists remotely, but no `auth.json` was listed.
- SSH config includes `RemoteForward 127.0.0.1:1080 127.0.0.1:1080`.
- Remote `127.0.0.1:1080` is listening and accepts TCP connections.
- A proxied `curl -I https://api.openai.com` reaches Cloudflare through the forwarded proxy; direct access did not produce a response during the bounded probe.
- `https://www.baidu.com` responds directly.
- `nvidia-smi` is not installed.

The remaining blocker for real remote Codex dispatch on this node is authentication. Workspace provisioning now expects the target workspace to be fetchable from git.
