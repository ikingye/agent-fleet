import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const docsDir = join(root, "docs");

const requiredDocs = [
  "index.md",
  "what-is-agent-fleet.md",
  "steward-worker-model.md",
  "getting-started.md",
  "cli.md",
  "dashboard.md",
  "connectors-security.md",
  "remote-workers.md",
  "recovery.md",
  "configuration-reference.md",
  "v0.1.0-limitations.md"
];

function collectTextFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      return collectTextFiles(path);
    }

    return /\.(css|html|md|mts|ts|tsx|yml|yaml|json)$/.test(entry) ? [path] : [];
  });
}

describe("docs site", () => {
  it("has a v0.1.0-ready static docs entry point and required guide pages", () => {
    const packageJson = readFileSync(join(root, "package.json"), "utf8");
    expect(packageJson).toContain('"docs:build": "tsc -p tsconfig.docs.json --noEmit && vite build --config vite.docs.config.ts"');
    expect(readFileSync(join(root, "vite.docs.config.ts"), "utf8")).toContain("docs-site");
    expect(readFileSync(join(root, "docs-site", "index.html"), "utf8")).toContain("agent-fleet");

    for (const doc of requiredDocs) {
      const text = readFileSync(join(docsDir, doc), "utf8");
      expect(text.trim(), doc).not.toHaveLength(0);
      expect(text, doc).toMatch(/^# /m);
    }

    const workflow = readFileSync(join(root, ".github", "workflows", "pages.yml"), "utf8");
    expect(workflow).toContain("actions/deploy-pages");
    expect(workflow).toContain("npm run docs:build");
    expect(workflow).toContain("docs-site/dist");
  });

  it("keeps docs and Pages workflow free of private local references", () => {
    const scannedFiles = [
      ...collectTextFiles(docsDir),
      ...collectTextFiles(join(root, "docs-site")),
      join(root, ".github", "workflows", "pages.yml")
    ];

    const forbiddenPatterns = [
      { label: "owner home path", pattern: /\/Users\/yewang\b/ },
      { label: "remote worker host alias", pattern: /\baicp-hhht-[\w-]+\b/ },
      { label: "private IPv4 address", pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/ },
      { label: "local host example", pattern: /\bmac-mini\.local\b/ },
      { label: "raw secret assignment", pattern: /(?:TOKEN|SECRET|KEY)=["']?[A-Za-z0-9_/-]{16,}/ }
    ];

    for (const file of scannedFiles) {
      const text = readFileSync(file, "utf8");
      for (const { label, pattern } of forbiddenPatterns) {
        expect(text, `${relative(root, file)} contains ${label}`).not.toMatch(pattern);
      }
    }
  });
});
