import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "agent-fleet";
const defaultBase = repositoryName.endsWith(".github.io") ? "/" : `/${repositoryName}/`;
const rawDocsBase = process.env.DOCS_BASE?.trim();
const docsBase = normalizeBase(rawDocsBase ? rawDocsBase : defaultBase);

export default defineConfig({
  plugins: [react()],
  root: "docs-site",
  base: docsBase,
  publicDir: resolve(__dirname, "docs/public"),
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});

function normalizeBase(value: string): string {
  const trimmed = value.trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}
