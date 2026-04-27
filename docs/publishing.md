# Publishing Docs To GitHub Pages

The docs site is a static Vite/React project in `docs-site/` that renders Markdown content from `docs/`. It builds to `docs-site/dist` and can be deployed by GitHub Pages Actions when Pages is enabled for the repository.

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

For a project Pages URL such as `https://OWNER.github.io/agent-fleet/`, the default base path is derived from the repository name and should be:

```text
/agent-fleet/
```

For a custom domain or root Pages repository, set:

```sh
DOCS_BASE=/ npm run docs:build
```

The workflow also accepts `DOCS_BASE` from repository, organization, or environment variables if a release manager configures one.

## GitHub Pages Workflow

The workflow lives at:

```text
.github/workflows/pages.yml
```

It:

- Runs on pushes to `main` that touch docs, package files, or the workflow.
- Supports manual `workflow_dispatch`.
- Installs with `npm ci`.
- Runs `npm run docs:build`.
- Uploads `docs-site/dist` as a Pages artifact.
- Deploys with the official Pages deployment action.

## Release Manager Setup

To publish:

1. Merge the docs branch into `main`.
2. In repository settings, enable GitHub Pages.
3. Set Build and deployment source to GitHub Actions.
4. Configure `DOCS_BASE=/` only if using a custom domain or root Pages repository.
5. Trigger the Pages workflow or push to `main`.
6. Review the deployed page URL from the workflow summary.

The workflow is compatible with private repositories when the GitHub plan and repository settings allow GitHub Pages. If Pages or Actions are disabled, the build still works locally but deployment will not run successfully.

## Do Not Publish From This Branch Directly

This branch prepares the docs site. It does not merge, tag, publish Pages, change repository visibility, or alter release settings. Those actions belong to the release manager.
