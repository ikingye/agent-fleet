# Development

## Requirements

- Node.js 24+
- npm 10+

## Install

```sh
npm ci
```

## Run

```sh
cd /Users/yewang/code/project/agent-fleet
npm run dev
```

The server uses `AGENT_FLEET_*` environment variables documented in [configuration.md](configuration.md).

Default local URLs:

- Web app: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

Use Steward Chat and Steward Intake to manage external workspaces. Keep the dashboard compact and management-only; business project code and UI belong in the submitted Target directory, not in the agent-fleet dashboard.

## Verify

Run the same checks expected in CI:

```sh
npm run check
npm run build
```

`npm run check` performs server and web typechecking, Vitest tests, and community file validation.

For community metadata only, run:

```sh
npm run check:community
```

At the current refresh point, agent-fleet had passed `npm run check` and `npm run build`; `/Users/yewang/code/project/mahjong` had passed `npm test`, `npm run check`, and `npm run build`.

## Testing

- Put server tests next to the module they cover.
- Put client tests next to the component or API wrapper they cover.
- Add tests before changing behavior.
- Keep process-spawning behavior behind Worker adapter tests.

## Directory Standards

Root-level config files are expected for TypeScript, Vite, Vitest, npm, and CI. New application behavior should go under `src`; new product or operations documentation should go under `docs`.
