# Configuration

agent-fleet keeps configuration small and explicit.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `AGENT_FLEET_HOST` | `127.0.0.1` | HTTP bind host. Keep this loopback-only unless you understand the exposure. |
| `AGENT_FLEET_PORT` | `8787` | HTTP bind port. |
| `AGENT_FLEET_DB` | `.agent-fleet/agent-fleet.sqlite` | SQLite database path. |

Example:

```bash
AGENT_FLEET_HOST=127.0.0.1 \
AGENT_FLEET_PORT=8787 \
AGENT_FLEET_DB=.agent-fleet/agent-fleet.sqlite \
npm start
```

## Remote Proxy Fallback

For remote servers that need selected blocked domains to exit through your laptop proxy, configure SSH:

```sshconfig
Host remote-dev
    HostName 203.0.113.10
    User ubuntu
    IdentityFile ~/.ssh/agent_fleet_remote
    RemoteForward 127.0.0.1:1080 127.0.0.1:1080
```

Then use remote node proxy mode `auto` with:

```text
http://127.0.0.1:1080
```

`auto` mode keeps normal traffic direct and uses proxy checks for fallback domains.

## Local State

The following paths are intentionally ignored by git:

- `.agent-fleet/`
- `.worktrees/`
- `.env`
- logs and test output

Do not move runtime state into tracked paths.
