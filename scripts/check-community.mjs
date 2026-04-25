import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const requiredPaths = [
  "README.md",
  "LICENSE",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "GOVERNANCE.md",
  "ROADMAP.md",
  "MAINTAINERS.md",
  ".env.example",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/remote_node.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-review.yml",
  "docs/getting-started.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/development.md",
  "docs/remote/macos-offload.md"
];

const ignoredDirectories = new Set([".git", ".agent-fleet", ".worktrees", "node_modules", "dist"]);
const sensitivePatterns = [
  { pattern: /1\.180\.13\.251/g, message: "real remote server IP" },
  { pattern: new RegExp("aicp-" + "hhht-231", "g"), message: "private SSH host alias" },
  {
    pattern: new RegExp(String.raw`IdentityFile\s+~/\.ssh/` + "id_" + "rsa", "g"),
    message: "personal default SSH identity example"
  },
  { pattern: /docs\/superpowers/g, message: "internal planning docs path" }
];

function walk(dir) {
  const entries = [];

  for (const entry of readdirSync(dir)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else {
      entries.push(path);
    }
  }

  return entries;
}

const failures = [];

for (const path of requiredPaths) {
  if (!existsSync(path)) {
    failures.push(`missing required community file: ${path}`);
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

if (packageJson.private === true) {
  failures.push("package.json must not set private=true for public community readiness");
}

if (packageJson.license !== "Apache-2.0") {
  failures.push("package.json license must be Apache-2.0");
}

for (const path of walk(".")) {
  const content = readFileSync(path, "utf8");

  for (const { pattern, message } of sensitivePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      failures.push(`${path}: contains ${message}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Community readiness check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Community readiness check passed.");
