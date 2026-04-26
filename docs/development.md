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
npm run dev
```

The server uses `AGENT_FLEET_*` environment variables documented in [configuration.md](configuration.md).

## Verify

Run the same checks expected in CI:

```sh
npm run check
npm run build
```

`npm run check` performs server and web typechecking, Vitest tests, and community file validation.

## Testing

- Put server tests next to the module they cover.
- Put client tests next to the component or API wrapper they cover.
- Add tests before changing behavior.
- Keep process-spawning behavior behind Worker adapter tests.

## Directory Standards

Root-level config files are expected for TypeScript, Vite, Vitest, npm, and CI. New application behavior should go under `src`; new product or operations documentation should go under `docs`.
