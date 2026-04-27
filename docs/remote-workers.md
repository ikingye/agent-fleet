# Remote Workers

Remote Workers let expensive or long-running agent work run on disposable SSH execution nodes while the local control plane keeps durable state.

Remote machines are stateless compute resources. They do not own product state, Steward memory, or durable Worker session records.

Remote execution is intentionally explicit in v0.1.0. It is a framework and operations workflow, not a zero-setup cloud scheduler.

## When Remote Offload Applies

The Steward should prefer remote execution for high-load work when a registered node is ready and has capacity. Examples include:

- Long builds or test suites.
- Browser automation.
- Batch refactors.
- CPU-heavy analysis.
- GPU or CUDA tasks when a node is explicitly tagged for that capability.

Small ordinary goals can stay local even when remote capacity exists.

## Required Prerequisites

Before dispatching remote Workers, prepare:

- SSH reachability through a stable host alias such as `remote-worker-01`.
- A disposable absolute work root such as `/tmp/agent-fleet/work`.
- Worker runtime installation, such as Codex CLI, Claude Code, Gemini CLI, or another configured provider command.
- Provider login or Worker runtime authentication for the tool that will run on that host.
- Domain-aware proxy forwarding when needed.
- Git access to the repository.
- A GitHub deploy key, machine user, GitHub App, or equivalent owner-authorized repository credential for private repositories.
- Remote permissions that allow the Worker user to create scratch directories, run the provider CLI, read leased keys, and clean up ephemeral state.
- A readiness probe confirming the Worker command and work root are usable.

Do not copy the owner's personal private SSH key to a remote host.

## Scratch Layout

Use scratch paths for remote state:

```text
/tmp/agent-fleet/work/<project-slug>/<workspace-slug>/
/tmp/agent-fleet/runs/<worker-name>/
/tmp/agent-fleet/keys/<repo-slug>/github-deploy-key
```

Create directories with `0700` permissions and private key files with `0600`.

Remote copies are ephemeral. Durable key material, if used, belongs in ignored local workspace state:

```text
<workspacePath>/.agent-fleet/secrets/<repo-slug>/github-deploy-key
```

## Register A Node

Register execution nodes through the local API:

```sh
curl -X POST http://127.0.0.1:8787/api/execution-nodes \
  -H 'content-type: application/json' \
  -d '{
    "name": "remote-worker-01",
    "kind": "remote",
    "status": "unknown",
    "sshHost": "remote-worker-01",
    "workRoot": "/tmp/agent-fleet/work",
    "proxyUrl": "http://127.0.0.1:1080",
    "tags": ["remote", "linux", "high-cpu"],
    "capacity": 2
  }'
```

Use `status: "unknown"` while provisioning. Mark a node ready only after SSH, folders, provider login or Worker runtime authentication, GitHub auth, proxy, permissions, and workspace provisioning have been verified.

## SSH Config Example

Use placeholders and TEST-NET addresses in documentation:

```sshconfig
Host remote-worker-01
  HostName 203.0.113.10
  User worker
  IdentityFile ~/.ssh/id_ed25519_remote_worker
  Port 22
  RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

Do not commit real hostnames, private IPs, account names, or SSH config.

## GitHub And Deploy Keys

Private repositories require owner-authorized GitHub access. The v0.1.0 model prefers one repo-level deploy key, a machine user, or a GitHub App over per-Worker keys.

Deploy-key lease behavior:

- Acquire a repo/node lease before remote dispatch.
- Reuse active leases by incrementing refcount.
- Copy only the leased private key to the remote scratch key path.
- Heartbeat active leases.
- Mark stale leases after missed heartbeat.
- Delete remote key copies when refcount reaches zero or leases expire.
- Rotate keys only through owner-authorized steps.

Workers must not create, rotate, add, delete, or revoke GitHub deploy keys.

## Workspace Provisioning

Remote workspace provisioning uses git refs by default:

1. Local workspace must be a clean git checkout with `remote.origin.url`.
2. The Steward pushes a Worker ref to origin.
3. The remote node clones or fetches into scratch space.
4. The remote checkout uses a local branch derived from the Worker Name.
5. The Worker runs in the remote target workspace.
6. A review/merge Worker fetches result refs for review and integration.

Provisioning blocks instead of overwriting non-empty non-git remote paths.

## Proxy Model

Proxy configuration should be domain-aware. Use forwarded proxy variables only when the selected remote node needs them:

```text
HTTPS_PROXY=http://127.0.0.1:1080
HTTP_PROXY=http://127.0.0.1:1080
ALL_PROXY=socks5://127.0.0.1:1080
NO_PROXY=localhost,127.0.0.1
```

Prefer direct access for domains the remote can reach reliably.

## Related Docs

- [Remote macOS Offload](remote/macos-offload.md)
- [Remote Codex Bootstrap](remote/codex-bootstrap.md)
