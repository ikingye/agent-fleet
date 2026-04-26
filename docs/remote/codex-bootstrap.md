# Remote Codex Bootstrap

Remote Codex Workers run on disposable compute nodes. Treat the remote host as a replaceable executor: install runtime tools, authenticate Codex explicitly, let agent-fleet prepare scratch files under `/tmp/agent-fleet`, run the Worker, and keep durable state in agent-fleet plus git.

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

## GitHub Access for Remote Workers

Remote Workers are stateless, but the default remote provisioning path is not networkless. agent-fleet pushes a Worker ref to `origin`, the remote host clones or fetches that ref, and the remote Worker later pushes a result ref. For private GitHub repositories, the remote host needs an ephemeral GitHub credential with read and write access to the target repository.

Recommended credential choices:

- Best for one repository: one project/repo-level GitHub deploy key shared by all Workers for that repo through Steward-managed leases.
- Best for several private repositories: a dedicated machine user with its own SSH key and narrowly scoped repository access.
- Best for app-managed multi-repo access: a GitHub App installation with explicit repository grants.
- Acceptable for interactive setup: GitHub CLI device login on the remote host if the organization allows it.
- Avoid: copying the owner's personal private SSH key to the remote host. Do not paste private keys into logs, Worker prompts, dashboard notes, shell history, or final reports.

GitHub deploy keys are repository scoped: the same deploy key cannot be attached to multiple repositories. For multi-repo work, use a machine user or GitHub App instead of trying to reuse one deploy key across repos.

### Steward-Managed Deploy-Key Leases

Each project/repo should have at most one shared deploy key by default. The durable private key source lives in the local target project workspace under an ignored path, for example:

```text
<workspacePath>/.agent-fleet/secrets/<repo-slug>/github-deploy-key
<workspacePath>/.agent-fleet/secrets/<repo-slug>/github-deploy-key.pub
```

Use a stable `<repo-slug>` such as `owner-agent-fleet`. Before generating or placing key material, confirm the target repository ignores local control-plane secrets:

```gitignore
.agent-fleet/
```

Do not commit `.agent-fleet/secrets`, private keys, public/private key fingerprints tied to secrets policy, copied SSH config fragments, or smoke-test logs containing authentication details.

The owner must explicitly authorize any operation that grants or revokes repository access:

- generating or importing the project deploy key;
- adding the public key to GitHub as a repository deploy key, especially with write access;
- rotating the key;
- deleting the GitHub deploy key from the repository.

Workers must not create, add, rotate, or delete GitHub deploy keys. The Steward/control-plane owns the lease registry and cleanup workflow. A Worker only receives a prepared remote environment after the Steward has acquired a lease.

Recommended local key preparation, after owner authorization:

```sh
cd /path/to/project-workspace
repo_slug="OWNER-REPO"
install -d -m 700 ".agent-fleet/secrets/$repo_slug"
test -f ".agent-fleet/secrets/$repo_slug/github-deploy-key" ||
  ssh-keygen -t ed25519 \
    -f ".agent-fleet/secrets/$repo_slug/github-deploy-key" \
    -N "" \
    -C "agent-fleet deploy key $repo_slug"
chmod 600 ".agent-fleet/secrets/$repo_slug/github-deploy-key"
chmod 644 ".agent-fleet/secrets/$repo_slug/github-deploy-key.pub"
cat ".agent-fleet/secrets/$repo_slug/github-deploy-key.pub"
```

Add the printed public key to GitHub:

- Repository deploy key: GitHub repository -> Settings -> Deploy keys -> Add deploy key -> enable write access only if remote Workers must push result refs.
- Machine user: add the public key to the machine user's GitHub account, then grant that user the minimum repository access required.

For every remote dispatch that needs GitHub access, the Steward should:

1. Acquire or renew the repo/node lease in local control-plane state.
2. Copy the local ignored private key to an ephemeral remote path under `/tmp/agent-fleet/keys/<repo-slug>/github-deploy-key`.
3. Set remote permissions to `0700` on directories and `0600` on the private key.
4. Configure the git operation to use that key without writing durable remote SSH config.
5. Heartbeat the lease while the Worker is active.
6. Release the Worker session from the lease on normal exit.
7. When refcount reaches zero, or when the lease expires after TTL, remove the remote key copy and mark cleanup complete or failed in the control-plane audit record.

Remote install example:

```sh
ssh aicp-hhht-231 '
  umask 077
  repo_slug="OWNER-REPO"
  install -d -m 700 "/tmp/agent-fleet/keys/$repo_slug"
  install -d -m 700 "/tmp/agent-fleet/work"
  install -d -m 700 "/tmp/agent-fleet/runs"
  test ! -e "/tmp/agent-fleet/keys/$repo_slug/github-deploy-key" ||
    chmod 600 "/tmp/agent-fleet/keys/$repo_slug/github-deploy-key"
'
```

Pin GitHub host keys without printing secrets:

```sh
ssh aicp-hhht-231 '
  umask 077
  mkdir -p ~/.ssh
  touch ~/.ssh/known_hosts
  chmod 600 ~/.ssh/known_hosts
  ssh-keygen -F github.com >/dev/null || ssh-keyscan github.com >> ~/.ssh/known_hosts
'
```

Verify authentication without revealing secrets:

```sh
ssh aicp-hhht-231 '
  ssh -i /tmp/agent-fleet/keys/OWNER-REPO/github-deploy-key -o IdentitiesOnly=yes -T git@github.com
'
ssh aicp-hhht-231 '
  GIT_SSH_COMMAND="ssh -i /tmp/agent-fleet/keys/OWNER-REPO/github-deploy-key -o IdentitiesOnly=yes" \
    git ls-remote git@github.com:OWNER/REPO.git HEAD
'
```

`ssh -T git@github.com` usually exits with status `1` after printing a successful authentication greeting because GitHub does not provide shell access. Treat the greeting as success; treat permission denied or unknown key output as a blocker.

Verify write access by pushing and deleting a scratch branch. Use a test repository when possible, or a short-lived branch in the target repository:

```sh
ssh aicp-hhht-231 '
  set -eu
  umask 077
  install -d -m 700 /tmp/agent-fleet/runs
  scratch_dir=$(mktemp -d /tmp/agent-fleet/runs/github-auth-smoke.XXXXXX)
  branch="agent-fleet/remote-auth-smoke/$(hostname)-$(date +%Y%m%d%H%M%S)"
  export GIT_SSH_COMMAND="ssh -i /tmp/agent-fleet/keys/OWNER-REPO/github-deploy-key -o IdentitiesOnly=yes"
  git clone --depth 1 git@github.com:OWNER/REPO.git "$scratch_dir/repo"
  cd "$scratch_dir/repo"
  git switch -c "$branch"
  git -c user.name="agent-fleet remote smoke" -c user.email="agent-fleet@example.invalid" \
    commit --allow-empty -m "agent-fleet remote auth smoke"
  git push origin "HEAD:refs/heads/$branch"
  git push origin --delete "$branch"
  rm -rf "$scratch_dir"
'
```

Lease records should include the GitHub deploy key id if known, public key fingerprint, repository URL/slug, remote node id, local private key path, remote private key path, active Worker session ids, refcount, `lastHeartbeatAt`, `expiresAt`, and cleanup status. Lease acquire/release must be serialized by the Steward/control-plane. A Worker crash is handled by TTL expiry: stale leases are marked `stale`, their active session list is cleared, cleanup becomes `pending`, and the Steward attempts to delete only the ephemeral remote key copy. Deleting the GitHub deploy key from the repository remains an owner-authorized rotation or decommissioning action.

Optional HTTPS and proxy checks are useful when SSH works locally but the remote network has filtered access:

```sh
ssh aicp-hhht-231 'curl -I https://github.com'
ssh aicp-hhht-231 'HTTPS_PROXY=http://127.0.0.1:1080 curl -I https://github.com'
ssh aicp-hhht-231 'git -c http.proxy=http://127.0.0.1:1080 ls-remote https://github.com/OWNER/REPO.git HEAD'
```

Fallbacks when normal GitHub SSH is blocked:

- Use GitHub CLI device login on the remote host, then verify with `gh auth status` and `git ls-remote`. This is interactive and should be recorded as an operator action.
- Use a git bundle for a one-off read-only bootstrap when fetch access is unavailable. This does not support the normal result-ref push path, so it is not the recommended steady state.
- Temporarily change `origin` to a reachable internal mirror or alternate Git remote only for the affected workspace, then restore the canonical GitHub origin before review/merge. Record the workaround in the Worker session notes.

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
  "workRoot": "/tmp/agent-fleet/work",
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
- Codex auth and API keys are not copied as part of workspace provisioning. A project deploy key may be installed separately under `/tmp/agent-fleet/keys/<repo-slug>/` only after the Steward acquires a lease.
- Non-empty remote directories that are not git checkouts block provisioning instead of being deleted.

If provisioning blocks, fix the source-of-truth issue first: add a git origin, push required commits, authenticate the remote host to fetch that origin, or choose a local Worker for work that depends on uncommitted local state.

## Current `aicp-hhht-231` Probe

As of 2026-04-26:

- Codex CLI is installed at `/usr/local/bin/codex`.
- Remote Codex version is `0.125.0`.
- Node is installed at `/usr/local/bin/node`, version `v24.15.0`.
- npm is installed at `/usr/local/bin/npm`, version `11.12.1`.
- `@openai/codex@0.125.0` is installed globally under `/opt/node-v24/lib`.
- Current context says remote Codex login has succeeded.
- SSH config includes `RemoteForward 127.0.0.1:1080 127.0.0.1:1080`.
- Remote `127.0.0.1:1080` is listening and accepts TCP connections.
- A proxied `curl -I https://api.openai.com` reaches Cloudflare through the forwarded proxy; direct access did not produce a response during the bounded probe.
- `https://www.baidu.com` responds directly.
- GitHub SSH access is still missing and must be configured before private-repository remote provisioning can fetch or push Worker refs.
- `nvidia-smi` is not installed.

The remaining blocker for real remote Codex dispatch on this node is GitHub SSH authentication. Workspace provisioning expects the target workspace to be fetchable from git and the result ref to be pushable back to `origin`.
