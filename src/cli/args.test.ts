import { describe, expect, it } from "vitest";
import { DEFAULT_STEWARD_API_URL, parseStewardArgs } from "./args.js";

const parseContext = {
  cwd: "/tmp/current-workspace",
  env: {}
};

describe("parseStewardArgs", () => {
  it("defaults to an interactive chat in the current workspace", () => {
    expect(parseStewardArgs([], parseContext)).toEqual({
      kind: "chat",
      apiUrl: DEFAULT_STEWARD_API_URL,
      workspacePath: "/tmp/current-workspace",
      projectName: undefined,
      once: undefined,
      json: false,
      interactive: true
    });
  });

  it("parses chat options for a single message", () => {
    expect(
      parseStewardArgs(
        [
          "chat",
          "--workspace",
          "/tmp/project",
          "--project",
          "mahjong",
          "--api-url",
          "http://127.0.0.1:9999/",
          "--once",
          "What is next?",
          "--json"
        ],
        parseContext
      )
    ).toEqual({
      kind: "chat",
      apiUrl: "http://127.0.0.1:9999",
      workspacePath: "/tmp/project",
      projectName: "mahjong",
      once: "What is next?",
      json: true,
      interactive: false
    });
  });

  it("reads the default API URL from STEWARD_API_URL", () => {
    expect(
      parseStewardArgs(["status"], {
        cwd: "/tmp/current-workspace",
        env: { STEWARD_API_URL: "http://127.0.0.1:8989/" }
      })
    ).toEqual({
      kind: "status",
      apiUrl: "http://127.0.0.1:8989"
    });
  });

  it("parses the serve command", () => {
    expect(parseStewardArgs(["serve"], parseContext)).toEqual({
      kind: "serve"
    });
  });

  it("parses provider config commands", () => {
    expect(parseStewardArgs(["config", "show", "--config", "/tmp/agent-fleet-config.json"], parseContext)).toEqual({
      kind: "configShow",
      configPath: "/tmp/agent-fleet-config.json"
    });

    expect(parseStewardArgs(["config", "init", "--config", "/tmp/agent-fleet-config.json", "--force"], parseContext)).toEqual({
      kind: "configInit",
      configPath: "/tmp/agent-fleet-config.json",
      force: true
    });

    expect(parseStewardArgs(["config", "set-steward", "--provider", "codex-main"], parseContext)).toEqual({
      kind: "configSetSteward",
      configPath: undefined,
      providerId: "codex-main"
    });
  });

  it("parses Worker provider list and set commands", () => {
    expect(parseStewardArgs(["providers", "list", "--config", "/tmp/providers.json"], parseContext)).toEqual({
      kind: "providersList",
      configPath: "/tmp/providers.json"
    });

    expect(
      parseStewardArgs(
        [
          "providers",
          "set",
          "--id",
          "codex-main",
          "--type",
          "codex",
          "--command",
          "codex exec --model {model} -",
          "--model",
          "gpt-5-codex",
          "--priority",
          "42",
          "--tags",
          "high-cpu,review",
          "--local",
          "true",
          "--remote",
          "false",
          "--enabled",
          "true"
        ],
        parseContext
      )
    ).toEqual({
      kind: "providersSet",
      configPath: undefined,
      provider: {
        id: "codex-main",
        type: "codex",
        roles: ["worker"],
        commandProfiles: {
          default: {
            commandTemplate: "codex exec --model {model} -"
          }
        },
        defaultCommandProfile: "default",
        defaultModel: "gpt-5-codex",
        enabled: true,
        priority: 42,
        tags: ["high-cpu", "review"],
        supportsLocal: true,
        supportsRemote: false
      }
    });
  });

  it("parses human provider type labels and legacy aliases", () => {
    expect(
      parseStewardArgs(["providers", "set", "--id", "claude-review", "--type", "claude", "--command", "claude"], parseContext)
    ).toMatchObject({
      kind: "providersSet",
      provider: {
        type: "claude"
      }
    });
    expect(
      parseStewardArgs(["providers", "set", "--id", "gemini-heavy", "--type", "gemini", "--command", "gemini"], parseContext)
    ).toMatchObject({
      kind: "providersSet",
      provider: {
        type: "gemini"
      }
    });
    expect(
      parseStewardArgs(
        ["providers", "set", "--id", "legacy-claude", "--type", "claude_code", "--command", "claude"],
        parseContext
      )
    ).toMatchObject({
      kind: "providersSet",
      provider: {
        type: "claude_code"
      }
    });
    expect(
      parseStewardArgs(
        ["providers", "set", "--id", "legacy-gemini", "--type", "gemini_cli", "--command", "gemini"],
        parseContext
      )
    ).toMatchObject({
      kind: "providersSet",
      provider: {
        type: "gemini_cli"
      }
    });
  });

  it("rejects options without values", () => {
    expect(() => parseStewardArgs(["chat", "--workspace"], parseContext)).toThrow("--workspace requires a value");
  });
});
