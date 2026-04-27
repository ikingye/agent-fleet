import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentFleetConfigPath,
  defaultAgentFleetConfig,
  loadAgentFleetConfig,
  normalizeAgentFleetConfig,
  providerFromLegacyWorkerCommand,
  readAgentFleetConfig,
  renderProviderCommand,
  saveAgentFleetConfig,
  selectWorkerProvider,
  workerKindForProviderType
} from "./agentProviderConfig.js";

const codexProfile = { default: { commandTemplate: "codexyoloproxy" } };

describe("agent provider config", () => {
  it("creates durable defaults that match the legacy codexyoloproxy Worker behavior", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provider-config-"));
    const configPath = join(dir, ".agent-fleet", "config.json");

    try {
      const config = await loadAgentFleetConfig(configPath);

      expect(config).toMatchObject({
        version: 1,
        stewardProviderId: "codexyoloproxy",
        stewardProvider: {
          id: "codexyoloproxy",
          type: "codex",
          roles: ["steward"],
          commandProfiles: codexProfile,
          defaultCommandProfile: "default",
          defaultModel: null,
          enabled: true
        },
        workerProviders: [
          {
            id: "codexyoloproxy",
            type: "codex",
            roles: ["worker"],
            commandProfiles: codexProfile,
            defaultCommandProfile: "default",
            defaultModel: null,
            enabled: true,
            priority: 100,
            tags: [],
            supportsLocal: true,
            supportsRemote: true
          }
        ]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults provider config to the user config directory unless AGENT_FLEET_CONFIG overrides it", () => {
    expect(
      agentFleetConfigPath("/workspace", {
        AGENT_FLEET_CONFIG: "/custom/config.json",
        XDG_CONFIG_HOME: "/xdg",
        HOME: "/home/owner"
      })
    ).toBe("/custom/config.json");
    expect(agentFleetConfigPath("/workspace", { XDG_CONFIG_HOME: "/xdg", HOME: "/home/owner" })).toBe(
      "/xdg/agent-fleet/config.json"
    );
    expect(agentFleetConfigPath("/workspace", { HOME: "/home/owner" })).toBe(
      "/home/owner/.config/agent-fleet/config.json"
    );
  });

  it("can read missing config without creating user-level files during app startup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provider-config-"));
    const configPath = join(dir, "missing", "config.json");

    try {
      await expect(readAgentFleetConfig(configPath)).resolves.toBeNull();
      await expect(readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates partial legacy commandTemplate config without losing provider details", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provider-config-"));
    const configPath = join(dir, "config.json");

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          workerProviders: [
            {
              id: "remote-codex",
              type: "codex",
              commandTemplate: "codex exec --model {model} -",
              defaultModel: "gpt-5-codex",
              tags: ["HIGH-CPU", " high-cpu "]
            }
          ]
        })
      );

      const config = await loadAgentFleetConfig(configPath);

      expect(config.stewardProviderId).toBe("codexyoloproxy");
      expect(config.workerProviders).toEqual([
        expect.objectContaining({
          id: "remote-codex",
          type: "codex",
          roles: ["worker"],
          commandProfiles: { default: { commandTemplate: "codex exec --model {model} -" } },
          defaultCommandProfile: "default",
          defaultModel: "gpt-5-codex",
          enabled: true,
          priority: 100,
          tags: ["high-cpu"],
          supportsLocal: true,
          supportsRemote: true
        })
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("selects enabled Worker providers by local/remote suitability, required tags, and priority", () => {
    const config = defaultAgentFleetConfig();
    config.workerProviders = [
      {
        id: "disabled",
        type: "codex",
        roles: ["worker"],
        commandProfiles: { default: { commandTemplate: "codex" } },
        defaultCommandProfile: "default",
        defaultModel: null,
        enabled: false,
        priority: 999,
        tags: ["high-cpu"],
        supportsLocal: true,
        supportsRemote: true
      },
      {
        id: "local-low",
        type: "claude_code",
        roles: ["worker"],
        commandProfiles: { default: { commandTemplate: "claude --model {model}" } },
        defaultCommandProfile: "default",
        defaultModel: "claude-sonnet",
        enabled: true,
        priority: 10,
        tags: ["high-cpu"],
        supportsLocal: true,
        supportsRemote: false
      },
      {
        id: "local-high",
        type: "gemini_cli",
        roles: ["worker"],
        commandProfiles: { default: { commandTemplate: "gemini --model {model}" } },
        defaultCommandProfile: "default",
        defaultModel: "gemini-2.5-pro",
        enabled: true,
        priority: 50,
        tags: ["high-cpu", "review"],
        supportsLocal: true,
        supportsRemote: true
      }
    ];

    expect(selectWorkerProvider(config, { placement: "local", requiredTags: ["high-cpu"] })).toMatchObject({
      id: "local-high",
      defaultModel: "gemini-2.5-pro"
    });
    expect(selectWorkerProvider(config, { placement: "remote", requiredTags: ["high-cpu"] })).toMatchObject({
      id: "local-high"
    });
    expect(selectWorkerProvider(config, { placement: "remote", requiredTags: ["missing"] })).toBeNull();
  });

  it("renders model and provider placeholders as argv values without shell expansion", () => {
    const rendered = renderProviderCommand({
      id: "codex-main",
      type: "codex",
      roles: ["worker"],
      commandProfiles: {
        default: { commandTemplate: "codex exec --model {model} --provider {providerId} --type {providerType} -" }
      },
      defaultCommandProfile: "default",
      defaultModel: "gpt-5 codex; rm -rf /",
      enabled: true,
      priority: 100,
      tags: [],
      supportsLocal: true,
      supportsRemote: true
    });

    expect(rendered).toEqual({
      command: "codex",
      args: ["exec", "--model", "gpt-5 codex; rm -rf /", "--provider", "codex-main", "--type", "codex", "-"],
      displayCommand: "codex exec --model 'gpt-5 codex; rm -rf /' --provider codex-main --type codex -",
      model: "gpt-5 codex; rm -rf /"
    });
  });

  it("keeps legacy Worker command and args compatible by converting them into a provider", () => {
    const provider = providerFromLegacyWorkerCommand("codex", ["exec", "--json", "--sandbox", "workspace-write", "-"]);

    expect(provider).toMatchObject({
      id: "legacy-worker-command",
      type: "codex",
      roles: ["worker"],
      commandProfiles: { default: { commandTemplate: "codex exec --json --sandbox workspace-write -" } },
      defaultCommandProfile: "default",
      enabled: true,
      supportsLocal: true,
      supportsRemote: true
    });
    expect(renderProviderCommand(provider)).toMatchObject({
      command: "codex",
      args: ["exec", "--json", "--sandbox", "workspace-write", "-"]
    });
  });

  it("accepts human provider type labels while preserving legacy aliases", () => {
    const config = normalizeAgentFleetConfig({
      workerProviders: [
        {
          id: "claude-review",
          type: "claude",
          commandTemplate: "claude --type {providerType}"
        },
        {
          id: "gemini-heavy",
          type: "gemini",
          commandTemplate: "gemini --type {providerType}"
        },
        {
          id: "legacy-claude-review",
          type: "claude_code",
          commandTemplate: "claude --type {providerType}"
        },
        {
          id: "legacy-gemini-heavy",
          type: "gemini_cli",
          commandTemplate: "gemini --type {providerType}"
        }
      ]
    });

    expect(config.workerProviders.map((provider) => provider.type)).toEqual([
      "claude",
      "gemini",
      "claude_code",
      "gemini_cli"
    ]);
    expect(renderProviderCommand(config.workerProviders[0]).args).toEqual(["--type", "claude"]);
    expect(renderProviderCommand(config.workerProviders[1]).args).toEqual(["--type", "gemini"]);
    expect(workerKindForProviderType("claude")).toBe("claude");
    expect(workerKindForProviderType("gemini")).toBe("gemini");
  });

  it("saves normalized config for later CLI and server runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-fleet-provider-config-"));
    const configPath = join(dir, "config.json");

    try {
      await saveAgentFleetConfig(configPath, {
        version: 1,
        stewardProviderId: "custom-steward",
        stewardProvider: {
          id: "custom-steward",
          type: "custom",
          roles: ["steward"],
          commandProfiles: { default: { commandTemplate: "my-steward --model {model}" } },
          defaultCommandProfile: "default",
          defaultModel: "owner-model",
          enabled: true
        },
        workerProviders: [
          {
            id: "custom-worker",
            type: "custom",
            roles: ["worker"],
            commandProfiles: { default: { commandTemplate: "worker --model {model}" } },
            defaultCommandProfile: "default",
            defaultModel: "worker-model",
            enabled: true,
            priority: 25,
            tags: ["review"],
            supportsLocal: true,
            supportsRemote: false
          }
        ]
      });

      await expect(loadAgentFleetConfig(configPath)).resolves.toMatchObject({
        stewardProviderId: "custom-steward",
        workerProviders: [expect.objectContaining({ id: "custom-worker", priority: 25 })]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
