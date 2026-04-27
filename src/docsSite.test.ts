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

  it("uses public docs chrome with a repository link and static version selector", () => {
    const app = readFileSync(join(root, "docs-site", "src", "App.tsx"), "utf8");
    const styles = readFileSync(join(root, "docs-site", "src", "styles.css"), "utf8");

    expect(app).toContain('href="https://github.com/ikingye/agent-fleet"');
    expect(app).toContain('aria-label="GitHub repository"');
    expect(app).toContain('aria-label="Documentation version"');
    expect(app).toContain('value="latest"');
    expect(app).toContain('value="v0.1.0"');
    expect(styles).toContain(".github-link");
    expect(styles).toContain(".version-select");
  });

  it("keeps publishing notes out of the primary public docs route set", () => {
    const app = readFileSync(join(root, "docs-site", "src", "App.tsx"), "utf8");
    const content = readFileSync(join(root, "docs-site", "src", "content.ts"), "utf8");
    const home = readFileSync(join(docsDir, "index.md"), "utf8");

    expect(app).not.toContain("#publishing");
    expect(content).not.toContain('slug: "publishing"');
    expect(content).not.toContain("../../docs/publishing.md?raw");
    expect(home).not.toMatch(/GitHub Pages|Publishing Docs/i);
  });

  it("uses the canonical GitHub Pages docs URL in public README/docs copy", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const docsText = collectTextFiles(docsDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(readme).toContain("https://ikingye.github.io/agent-fleet/");
    expect(`${readme}\n${docsText}`).not.toContain("kingye.me/agent-fleet");
  });

  it("documents source install and avoids the conflicting public npm package", () => {
    const publicDocs = [
      readFileSync(join(root, "README.md"), "utf8"),
      readFileSync(join(docsDir, "getting-started.md"), "utf8"),
      readFileSync(join(docsDir, "what-is-agent-fleet.md"), "utf8")
    ].join("\n");

    expect(publicDocs).toContain("Do not run `npm install agent-fleet`");
    expect(publicDocs).toContain("The npm package name `agent-fleet` is already used by another project");
    expect(publicDocs).toContain("git clone https://github.com/ikingye/agent-fleet.git");
    expect(publicDocs).toContain("npm ci");
    expect(publicDocs).toContain("npm run build");
    expect(publicDocs).toContain("npm link");
    expect(publicDocs).toContain("node dist/cli/main.js");
    expect(publicDocs).not.toMatch(/^npm (?:install|i)(?: -g)? agent-fleet\b/m);
  });

  it("keeps public docs consistent with the public repository and local-first maturity", () => {
    const publicDocs = [
      readFileSync(join(root, "README.md"), "utf8"),
      readFileSync(join(docsDir, "getting-started.md"), "utf8"),
      readFileSync(join(docsDir, "what-is-agent-fleet.md"), "utf8"),
      readFileSync(join(docsDir, "v0.1.0-limitations.md"), "utf8"),
      readFileSync(join(docsDir, "remote-workers.md"), "utf8"),
      readFileSync(join(docsDir, "connectors-security.md"), "utf8")
    ].join("\n");

    expect(publicDocs).not.toMatch(/private\/internal git release|intentionally private in v0\.1\.0|internal git release line/i);
    expect(publicDocs).toMatch(/public repository/i);
    expect(publicDocs).toMatch(/not a hardened multi-user service/i);
    expect(publicDocs).toMatch(/JSON-backed local state/i);
    expect(publicDocs).toMatch(/Worker lifecycle|resume|production scheduling/i);
    expect(publicDocs).toMatch(/SSH/i);
    expect(publicDocs).toMatch(/provider login|Worker runtime authentication/i);
    expect(publicDocs).toMatch(/GitHub deploy key|machine user/i);
    expect(publicDocs).toMatch(/proxy/i);
    expect(publicDocs).toMatch(/localhost|127\.0\.0\.1/i);
    expect(publicDocs).toMatch(/HMAC/i);
    expect(publicDocs).toMatch(/sender allowlist/i);
    expect(publicDocs).toMatch(/generic gateway/i);
    expect(publicDocs).toMatch(/not a full WeChat\/IM SDK/i);
  });

  it("describes v0.1.0 as current public product scope instead of a raw release note", () => {
    const limitations = readFileSync(join(docsDir, "v0.1.0-limitations.md"), "utf8");

    expect(limitations).toMatch(/^# Current Scope And Limits$/m);
    expect(limitations).toMatch(/^## Supported Surfaces$/m);
    expect(limitations).toMatch(/^## Operational Cautions$/m);
    expect(limitations).not.toMatch(/private\/internal git release|Release Manager Checklist|Before v0\.1\.0 release/i);
    expect(limitations).not.toMatch(/Docs publishing/i);
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
