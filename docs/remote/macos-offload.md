# macOS Remote Offload

Remote execution is a planned capability. The goal is to keep the local Mac responsive while Worker Agents, builds, tests, and browser automation run on remote Linux machines.

## Target Behavior

- The Steward Agent chooses local or remote execution based on project policy, machine load, and task needs.
- Worker sessions record host, cwd, worktree, command, pid, resume id, status, and logs.
- The browser control plane remains local and responsive.
- Interrupted remote sessions can be resumed without reconstructing terminal state by hand.

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
    "workRoot": "/Users/worker/agent-fleet",
    "proxyUrl": "http://127.0.0.1:1080"
  }'
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

When a remote node is marked `ready`, the API rejects clearly unusable records such as a missing SSH host or a relative work root. Nodes can still be registered as `unknown` while SSH, folders, and proxy forwarding are being prepared.

## Readiness Model

`src/server/remote/remoteNodeReadiness.ts` contains a pure readiness check for remote node facts the Steward already knows, such as status, SSH host, work root, and whether a proxy is required. It does not open SSH connections or probe the network; future adapters should record probe results separately and pass those facts into the readiness helper.
