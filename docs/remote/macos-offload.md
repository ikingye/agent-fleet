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

## Readiness Model

`src/server/remote/remoteNodeReadiness.ts` contains a pure readiness check for remote node facts the Steward already knows, such as status, SSH host, work root, and whether a proxy is required. It does not open SSH connections or probe the network; future adapters should record probe results separately and pass those facts into the readiness helper.
