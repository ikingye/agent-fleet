import { readFile } from "node:fs/promises";

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "LICENSE",
  "MAINTAINERS.md",
  "ROADMAP.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/development.md",
  "docs/getting-started.md",
  "docs/product-brief.md",
  "docs/remote/macos-offload.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/ci.yml"
];

const missing = [];

for (const file of requiredFiles) {
  try {
    await readFile(file, "utf8");
  } catch {
    missing.push(file);
  }
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));

if (packageJson.private !== true) {
  throw new Error("package.json must keep private=true until the project is intentionally published.");
}

if (missing.length > 0) {
  throw new Error(`Missing community files:\n${missing.map((file) => `- ${file}`).join("\n")}`);
}
