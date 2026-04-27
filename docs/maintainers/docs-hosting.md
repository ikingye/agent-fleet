# Maintainer Note: Docs Hosting

This note is for repository maintainers. It is intentionally not part of the primary public docs navigation.

The public docs site is a static Vite/React project in `docs-site/` that renders Markdown content from `docs/`. It builds to `docs-site/dist` and is hosted at `https://ikingye.github.io/agent-fleet/`.

## Local Preview

Install dependencies:

```sh
npm ci
```

Run a dev server:

```sh
npm run docs:dev
```

Build static output:

```sh
npm run docs:build
```

Preview the built site:

```sh
npm run docs:preview
```

## Base Path

For the canonical project docs URL `https://ikingye.github.io/agent-fleet/`, the default base path is derived from the repository name and should be:

```text
/agent-fleet/
```

For a custom domain or root Pages repository, set:

```sh
DOCS_BASE=/ npm run docs:build
```

The workflow also accepts `DOCS_BASE` from repository, organization, or environment variables if a release manager configures one.

## Hosting Workflow

The workflow lives at:

```text
.github/workflows/pages.yml
```

It:

- Runs on pushes to `main` that touch docs, package files, or the workflow.
- Supports manual `workflow_dispatch`.
- Installs with `npm ci`.
- Runs `npm run docs:build`.
- Uploads `docs-site/dist` as a hosting artifact.
- Deploys with the repository hosting workflow.

## Maintainer Setup

To publish:

1. Merge the docs branch into `main`.
2. In repository settings, enable GitHub Pages.
3. Set Build and deployment source to GitHub Actions.
4. Configure `DOCS_BASE=/` only if using a custom domain or root Pages repository.
5. Trigger the Pages workflow or push to `main`.
6. Review the deployed page URL from the workflow summary.

If hosting or Actions are disabled, the build still works locally but deployment will not run successfully.

## Do Not Deploy From This Branch Directly

Docs branches prepare site changes for review. They do not merge, tag, deploy hosted docs, change repository visibility, or alter release settings. Those actions belong to the maintainer handling the release.
