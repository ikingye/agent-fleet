# macOS Remote Offload

Remote execution keeps the local Mac responsive while Worker Agents, builds, tests, and browser automation run on a pool of remote Linux machines.

For Codex-specific remote bootstrap, authentication, and proxy verification steps, see [Remote Codex Bootstrap](codex-bootstrap.md).

## Target Behavior

- The Steward Agent treats remote servers as stateless compute resources, not project owners or durable sources of truth.
- The Steward Agent prefers a registered ready remote execution node for high-load work and falls back to local execution when no remote node can take the task.
- Worker sessions record host, target workspace cwd, worktree, command, pid, resume id, status, and logs.
- The browser control plane remains local, compact, and management-only.
- Interrupted remote sessions can be resumed without reconstructing terminal state by hand.

## SSH Worker Adapter

`src/server/workers/sshWorkerAdapter.ts` contains the SSH-backed Worker adapter. It launches the local SSH client with an argument array, not a local shell string:

```text
ssh <host> <quoted-remote-shell-command>
```

The remote command is a minimal `sh -lc` wrapper that changes to the requested remote `cwd`, applies optional environment variables, and `exec`s the Worker command:

```sh
cd '<remote target workspace>' && exec env HTTPS_PROXY='<proxy url>' codex exec --json --sandbox workspace-write -
```

Use the submitted `workspacePath` / Target directory as the project location. Remote `workRoot` is node capacity metadata; business project code and UI still belong in the target workspace, not in the agent-fleet dashboard. Remote workspaces are disposable scratch space. The source of truth stays in git and the local control-plane state; remote files must not be treated as durable project state.

When a ready remote node is selected, the Steward maps the target workspace to a deterministic remote cwd:

```text
<execution node workRoot>/<project slug>/<workspace slug>
```

For example, project `agent-fleet` with target workspace `~/code/project/agent-fleet` on a node whose `workRoot` is `/root/agent-fleet-workspaces` runs at:

```text
/root/agent-fleet-workspaces/agent-fleet/agent-fleet
```

Behavior:

- The Steward prompt is forwarded to the SSH process over stdin.
- The adapter returns the SSH pid, initial output, status, and any resume id printed as `resume id: <value>` or `resume=<value>`.
- Startup timeout handling matches the local command adapter: if SSH is still running after the timeout, the session is reported as `running` with the output collected so far.
- If SSH exits nonzero or fails to spawn, the session is reported as `failed` and the SSH output is kept for inspection.
- Tests use an injectable runner to capture `command`, `args`, and stdin without requiring a real SSH server.

## Proxy Model

Some remote servers can reach mainland China sites directly but cannot reach Google-style endpoints. Proxy behavior should be domain-aware:

- Prefer direct access when the remote can reach a site reliably.
- Use SSH-configured forwarding for blocked domains.
- Avoid blindly proxying all traffic.

`src/server/remote/proxyPolicy.ts` contains the current pure routing policy. It routes configured mainland domains directly, uses a forwarded proxy only for configured global domains when a proxy URL is available, and leaves unconfigured domains on the direct route by default.

Example SSH config pattern:

```sshconfig
RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

The remote Worker process can then use the forwarded proxy for domains that require it.

The SSH Worker adapter does not decide which domains need a proxy. The Steward should use the proxy policy to decide whether to provide proxy environment variables for a Worker run. When proxying is required, pass explicit env vars such as:

```text
HTTPS_PROXY=http://127.0.0.1:1080
HTTP_PROXY=http://127.0.0.1:1080
ALL_PROXY=socks5://127.0.0.1:1080
NO_PROXY=localhost,127.0.0.1
```

For direct mainland access, omit these proxy env vars. This keeps direct-capable traffic off the forwarded proxy while still allowing Worker commands to reach global services when the remote host needs the Mac's local proxy.

## Registering Execution Nodes

Remote execution nodes are registered through the control-plane API. Posting the same `name` again updates the existing node instead of creating a duplicate:

```sh
curl -X POST http://127.0.0.1:8787/api/execution-nodes \
  -H 'content-type: application/json' \
  -d '{
    "name": "mac-mini-builder",
    "kind": "remote",
    "status": "unknown",
    "sshHost": "worker@mac-mini.local",
    "workRoot": "/srv/agent-fleet-workspaces",
    "proxyUrl": "http://127.0.0.1:1080",
    "tags": ["remote", "linux", "high-cpu"],
    "capacity": 2
  }'
```

Register as many remote nodes as are available. `aicp-hhht-231` is one SSH config host example, not a singleton or special project:

```sh
curl -X POST http://127.0.0.1:8787/api/execution-nodes \
  -H 'content-type: application/json' \
  -d '{
    "name": "aicp-hhht-231",
    "kind": "remote",
    "status": "ready",
    "sshHost": "aicp-hhht-231",
    "workRoot": "/root/agent-fleet-workspaces",
    "proxyUrl": "http://127.0.0.1:1080",
    "tags": ["remote", "linux", "china-network", "high-cpu"],
    "capacity": 2
  }'
```

Only add the `gpu` tag after a read-only probe confirms GPU capability, for example `ssh aicp-hhht-231 'command -v nvidia-smi && nvidia-smi -L'`. Do not infer GPU capability from the host name.

The SSH client should resolve the alias from `~/.ssh/config`, for example:

```sshconfig
Host aicp-hhht-231
  HostName 1.180.13.251
  User root
  IdentityFile ~/.ssh/id_rsa
  Port 231
  RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

Fields:

| Field | Required | Notes |
| --- | --- | --- |
| `name` | Yes | Stable unique name. Reuse it to update the same node. |
| `kind` | Yes | `remote` for SSH-backed nodes, `local` for the control-plane host. |
| `status` | Yes | `unknown`, `offline`, or `ready`. |
| `sshHost` | For ready remote nodes | SSH target such as `worker@mac-mini.local`; use `null` for local nodes. |
| `workRoot` | Yes | Absolute path where Worker sessions should run on that node. |
| `proxyUrl` | No | Forwarded proxy URL visible from the remote process, or `null`. |
| `tags` | No | Capability tags such as `remote`, `linux`, `gpu`, `high-cpu`, `china-network`, or `cuda`. Missing tags default to `[]` for old state. |
| `capacity` | No | Maximum concurrent Worker sessions for this node. Missing capacity defaults to `1` for old state. |

When a remote node is marked `ready`, the API rejects clearly unusable records such as a missing SSH host or a relative work root. Nodes can still be registered as `unknown` while SSH, folders, and proxy forwarding are being prepared.

## Dispatch Behavior

When a goal is accepted:

- The Steward detects simple resource needs from the goal title and body.
- Remote offload is selective: ordinary small goals stay local even when remote capacity exists.
- GPU goals currently match keywords such as `gpu`, `cuda`, `训练`, `模型`, `推理`, and `渲染`.
- CPU-heavy or long-running goals currently match keywords such as `long-running`, `overnight`, `持续`, `长时间`, `跑一晚`, `高cpu`, `cpu`, `heavy`, `high-load`, `高负载`, `并行`, `批量`, `build`, and `test`.
- The Steward filters for ready remote nodes whose `sshHost` is set, whose `workRoot` is absolute, and whose current running Worker sessions are below `capacity`.
- The scheduler only selects remote nodes whose tags satisfy the detected resource need, then prefers nodes with more available slots, then dashboard order for deterministic tie-breaking.
- The Worker session uses the SSH Worker adapter and records `hostId` as the selected execution node id.
- If no matching ready remote node has capacity, the Steward uses the local Worker adapter, records `hostId: null`, and includes the local fallback in the dispatch decision actions.
- Remote Worker commands receive proxy environment variables when the selected node has `proxyUrl` set.
- Remote-dispatched Worker Names include the `remote` marker before the timestamp: `<project-name>-<worker-purpose>-remote-<YYYYMMDDHHmm>`. Local Worker Names remain `<project-name>-<worker-purpose>-<YYYYMMDDHHmm>`. The Steward puts the Worker Name at the top of the Worker prompt and repeats it in dispatch audit records.

## Remote Workspace Provisioning

Before launching an SSH-backed Worker, the Steward prepares the selected remote cwd through Git refs by default:

- The local workspace must be inside a git repository with `remote.origin.url`.
- The local worktree must be clean according to `git status --porcelain=v1 -z`; dirty worktrees block remote git-ref sync by default.
- The Steward resolves `HEAD`, derives deterministic refs from the Worker Name, and pushes the Worker ref to `origin`.
- Worker refs use `refs/heads/agent-fleet/workers/<worker-name>`.
- Returned result refs use `refs/heads/agent-fleet/results/<worker-name>`.
- The remote host is treated as stateless scratch space. It clones or fetches from `origin`, fetches the Worker ref, and checks out a local branch from `FETCH_HEAD`.
- If the remote cwd exists but is non-empty and is not a git checkout, provisioning blocks instead of deleting or overwriting it.
- If the local workspace is not in git, has no origin URL, is dirty, cannot push the Worker ref, or cannot prepare the remote checkout, provisioning records a clear blocked Worker session/checkpoint instead of pretending that the remote cwd is usable.

After remote execution, the inbound sync path fetches the returned result ref from `origin` and checks it out to `agent-fleet/results/<worker-name>` for review. The review/merge Worker is responsible for deciding how that result branch is merged.

The default path intentionally does not rsync project directories, copy local uncommitted changes, copy secrets, or clean remote disks. `rsync` is only a fallback for future workflows that explicitly opt out of Git-ref sync. Remote `workRoot` is scratch/cache only. Durable project state remains in git and durable control-plane records.

Owner-facing audit records include whether provisioning prepared the remote workspace or blocked Worker launch. When blocked, the Worker session is recorded as failed with command `remote workspace provisioning`, and the checkpoint explains what must be fixed, such as adding a git origin or preparing remote authentication.

## Readiness Model

`src/server/remote/remoteNodeReadiness.ts` contains a pure readiness check for remote node facts the Steward already knows, such as status, SSH host, work root, and whether a proxy is required. API routes can also run a live SSH probe through `src/server/remote/remoteNodeProbe.ts` to check that the remote work root exists and the configured Worker command is available. Recovery reconcile uses a dashboard-aware process probe that checks local sessions locally and remote sessions by probing the recorded remote PID over SSH.

Probe results are still local control-plane facts. Remote machines remain stateless compute resources; they do not own durable Worker session state.
