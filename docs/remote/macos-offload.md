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

Example SSH config pattern:

```sshconfig
RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

The remote Worker process can then use the forwarded proxy for domains that require it.
