import architecture from "../../docs/architecture.md?raw";
import cli from "../../docs/cli.md?raw";
import configurationReference from "../../docs/configuration-reference.md?raw";
import connectorsSecurity from "../../docs/connectors-security.md?raw";
import dashboard from "../../docs/dashboard.md?raw";
import gettingStarted from "../../docs/getting-started.md?raw";
import home from "../../docs/index.md?raw";
import recovery from "../../docs/recovery.md?raw";
import remoteCodexBootstrap from "../../docs/remote/codex-bootstrap.md?raw";
import remoteMacosOffload from "../../docs/remote/macos-offload.md?raw";
import remoteWorkers from "../../docs/remote-workers.md?raw";
import stewardWorkerModel from "../../docs/steward-worker-model.md?raw";
import limitations from "../../docs/v0.1.0-limitations.md?raw";
import whatIsAgentFleet from "../../docs/what-is-agent-fleet.md?raw";

export interface DocsPage {
  slug: string;
  title: string;
  group: "Start" | "Interfaces" | "Operations" | "Reference" | "Deep Dives";
  description: string;
  body: string;
}

export const docsVersions = [
  {
    id: "latest",
    label: "latest",
    homeTitle: "agent-fleet latest Docs",
    homeDescription: "Latest docs track the current main branch.",
    homeLead: "Latest docs track the current main branch."
  },
  {
    id: "v0.1.0",
    label: "v0.1.0",
    homeTitle: "agent-fleet v0.1.0 Docs",
    homeDescription: "Version archive for the v0.1.0 release.",
    homeLead: "Version archive for the v0.1.0 release."
  }
] as const;

export type DocsVersion = (typeof docsVersions)[number]["id"];

export function parseDocsVersion(value: string | null | undefined): DocsVersion {
  return docsVersions.some((version) => version.id === value) ? (value as DocsVersion) : "latest";
}

export function buildDocsPages(version: DocsVersion): DocsPage[] {
  const metadata = docsVersions.find((candidate) => candidate.id === version) ?? docsVersions[0];

  return baseDocsPages.map((page) => {
    if (page.slug !== "home") {
      return page;
    }

    return {
      ...page,
      title: metadata.homeTitle,
      description: metadata.homeDescription,
      body: replaceHomeLead(replaceFirstMarkdownHeading(page.body, metadata.homeTitle), metadata.homeLead)
    };
  });
}

function replaceFirstMarkdownHeading(markdown: string, title: string): string {
  return markdown.replace(/^# .+$/m, `# ${title}`);
}

function replaceHomeLead(markdown: string, lead: string): string {
  return markdown.replace(
    "Latest docs track the current main branch.",
    lead
  );
}

const baseDocsPages: DocsPage[] = [
  {
    slug: "home",
    title: "agent-fleet latest Docs",
    group: "Start",
    description: "Latest docs track the current main branch.",
    body: home
  },
  {
    slug: "what-is-agent-fleet",
    title: "What Is agent-fleet",
    group: "Start",
    description: "Product purpose, current surface, and what the control plane is not.",
    body: whatIsAgentFleet
  },
  {
    slug: "steward-worker-model",
    title: "Steward/Worker Model",
    group: "Start",
    description: "Delegation boundary, Worker naming, decisions, corrections, and cleanup.",
    body: stewardWorkerModel
  },
  {
    slug: "getting-started",
    title: "Getting Started",
    group: "Start",
    description: "Install, configure a Worker command, run the app, and submit first work.",
    body: gettingStarted
  },
  {
    slug: "cli",
    title: "steward CLI",
    group: "Interfaces",
    description: "Terminal status, one-off chat, interactive chat, API URL, and token options.",
    body: cli
  },
  {
    slug: "dashboard",
    title: "Web Dashboard",
    group: "Interfaces",
    description: "Compact owner-facing control plane for chat, intake, decisions, and recovery.",
    body: dashboard
  },
  {
    slug: "connectors-security",
    title: "Connectors And Security",
    group: "Interfaces",
    description: "Webhook connector boundary, HMAC signing, sender allowlists, and limits.",
    body: connectorsSecurity
  },
  {
    slug: "remote-workers",
    title: "Remote Workers",
    group: "Operations",
    description: "Remote offload prerequisites, scratch layout, GitHub access, and proxy model.",
    body: remoteWorkers
  },
  {
    slug: "recovery",
    title: "Recovery And State",
    group: "Operations",
    description: "Durable state, recovery endpoint, checkpoints, and session reconciliation.",
    body: recovery
  },
  {
    slug: "configuration-reference",
    title: "Configuration Reference",
    group: "Reference",
    description: "Environment variables, connector shape, remote node fields, and docs build base.",
    body: configurationReference
  },
  {
    slug: "v0.1.0-limitations",
    title: "Current Scope And Limits",
    group: "Reference",
    description: "Supported surfaces, operational cautions, known limits, and roadmap direction.",
    body: limitations
  },
  {
    slug: "architecture",
    title: "Architecture Notes",
    group: "Deep Dives",
    description: "Existing engineering architecture notes for the local control-plane slice.",
    body: architecture
  },
  {
    slug: "remote-macos-offload",
    title: "Remote macOS Offload",
    group: "Deep Dives",
    description: "Detailed remote offload behavior and deploy-key lease model.",
    body: remoteMacosOffload
  },
  {
    slug: "remote-codex-bootstrap",
    title: "Remote Codex Bootstrap",
    group: "Deep Dives",
    description: "Remote Codex runtime, GitHub access, proxy, and readiness bootstrap.",
    body: remoteCodexBootstrap
  }
];

export const docsPages = buildDocsPages("latest");

export const docsGroups = ["Start", "Interfaces", "Operations", "Reference", "Deep Dives"] as const;
