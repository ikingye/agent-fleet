import type { AgentProviderType, WorkerProviderConfig } from "../shared/types.js";

export const DEFAULT_STEWARD_API_URL = "http://127.0.0.1:8787";

export interface ParseStewardArgsContext {
  cwd: string;
  env: Record<string, string | undefined>;
}

export type StewardCliCommand =
  | {
      kind: "chat";
      apiUrl: string;
      workspacePath: string;
      projectName: string | undefined;
      once: string | undefined;
      json: boolean;
      interactive: boolean;
    }
  | {
      kind: "status";
      apiUrl: string;
    }
  | {
      kind: "serve";
    }
  | {
      kind: "configShow";
      configPath: string | undefined;
    }
  | {
      kind: "configInit";
      configPath: string | undefined;
      force: boolean;
    }
  | {
      kind: "configSetSteward";
      configPath: string | undefined;
      providerId: string;
    }
  | {
      kind: "providersList";
      configPath: string | undefined;
    }
  | {
      kind: "providersSet";
      configPath: string | undefined;
      provider: WorkerProviderConfig;
    }
  | {
      kind: "providersToggle";
      configPath: string | undefined;
      providerId: string;
      enabled: boolean;
    }
  | {
      kind: "help";
    };

export class StewardCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StewardCliUsageError";
  }
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed === "") {
    throw new StewardCliUsageError("--api-url requires a non-empty value");
  }

  return trimmed.replace(/\/+$/, "");
}

function defaultApiUrl(env: Record<string, string | undefined>): string {
  return normalizeApiUrl(env.STEWARD_API_URL ?? DEFAULT_STEWARD_API_URL);
}

function readOptionValue(argv: string[], index: number, name: string): { value: string; nextIndex: number } {
  const current = argv[index];
  const equalsPrefix = `${name}=`;

  if (current.startsWith(equalsPrefix)) {
    const value = current.slice(equalsPrefix.length);

    if (value === "") {
      throw new StewardCliUsageError(`${name} requires a value`);
    }

    return { value, nextIndex: index + 1 };
  }

  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new StewardCliUsageError(`${name} requires a value`);
  }

  return { value, nextIndex: index + 2 };
}

function parseChatOptions(argv: string[], context: ParseStewardArgsContext): StewardCliCommand {
  let apiUrl = defaultApiUrl(context.env);
  let workspacePath = context.cwd;
  let projectName: string | undefined;
  let once: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      index += 1;
      continue;
    }

    if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      const result = readOptionValue(argv, index, "--workspace");
      workspacePath = result.value;
      index = result.nextIndex;
      continue;
    }

    if (arg === "--project" || arg.startsWith("--project=")) {
      const result = readOptionValue(argv, index, "--project");
      projectName = result.value;
      index = result.nextIndex;
      continue;
    }

    if (arg === "--api-url" || arg.startsWith("--api-url=")) {
      const result = readOptionValue(argv, index, "--api-url");
      apiUrl = normalizeApiUrl(result.value);
      index = result.nextIndex;
      continue;
    }

    if (arg === "--once" || arg.startsWith("--once=")) {
      const result = readOptionValue(argv, index, "--once");
      once = result.value;
      index = result.nextIndex;
      continue;
    }

    throw new StewardCliUsageError(`Unknown chat option: ${arg}`);
  }

  if (workspacePath.trim() === "") {
    throw new StewardCliUsageError("--workspace requires a non-empty value");
  }

  return {
    kind: "chat",
    apiUrl,
    workspacePath,
    projectName,
    once,
    json,
    interactive: once === undefined
  };
}

function parseStatusOptions(argv: string[], context: ParseStewardArgsContext): StewardCliCommand {
  let apiUrl = defaultApiUrl(context.env);

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    if (arg === "--api-url" || arg.startsWith("--api-url=")) {
      const result = readOptionValue(argv, index, "--api-url");
      apiUrl = normalizeApiUrl(result.value);
      index = result.nextIndex;
      continue;
    }

    throw new StewardCliUsageError(`Unknown status option: ${arg}`);
  }

  return {
    kind: "status",
    apiUrl
  };
}

function parseConfigPathOption(argv: string[], index: number): { configPath: string; nextIndex: number } {
  const result = readOptionValue(argv, index, "--config");

  if (result.value.trim() === "") {
    throw new StewardCliUsageError("--config requires a non-empty value");
  }

  return { configPath: result.value, nextIndex: result.nextIndex };
}

function parseProviderType(value: string): AgentProviderType {
  if (
    value === "codex" ||
    value === "claude" ||
    value === "gemini" ||
    value === "custom" ||
    value === "claude_code" ||
    value === "gemini_cli"
  ) {
    return value;
  }

  throw new StewardCliUsageError("--type must be one of: codex, claude, gemini, custom (legacy aliases: claude_code, gemini_cli)");
}

function parseBooleanValue(value: string, name: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new StewardCliUsageError(`${name} must be true or false`);
}

function parsePriority(value: string): number {
  const priority = Number(value);

  if (!Number.isFinite(priority)) {
    throw new StewardCliUsageError("--priority must be a finite number");
  }

  return Math.floor(priority);
}

function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag !== "")
    )
  ];
}

function parseConfigCommand(argv: string[]): StewardCliCommand {
  const [subcommand, ...rest] = argv;

  if (subcommand === "show") {
    let configPath: string | undefined;
    for (let index = 0; index < rest.length; ) {
      const arg = rest[index];
      if (arg === "--config" || arg.startsWith("--config=")) {
        const result = parseConfigPathOption(rest, index);
        configPath = result.configPath;
        index = result.nextIndex;
        continue;
      }

      throw new StewardCliUsageError(`Unknown config show option: ${arg}`);
    }

    return { kind: "configShow", configPath };
  }

  if (subcommand === "init") {
    let configPath: string | undefined;
    let force = false;
    for (let index = 0; index < rest.length; ) {
      const arg = rest[index];
      if (arg === "--force") {
        force = true;
        index += 1;
        continue;
      }

      if (arg === "--config" || arg.startsWith("--config=")) {
        const result = parseConfigPathOption(rest, index);
        configPath = result.configPath;
        index = result.nextIndex;
        continue;
      }

      throw new StewardCliUsageError(`Unknown config init option: ${arg}`);
    }

    return { kind: "configInit", configPath, force };
  }

  if (subcommand === "set-steward") {
    let configPath: string | undefined;
    let providerId: string | undefined;
    for (let index = 0; index < rest.length; ) {
      const arg = rest[index];
      if (arg === "--config" || arg.startsWith("--config=")) {
        const result = parseConfigPathOption(rest, index);
        configPath = result.configPath;
        index = result.nextIndex;
        continue;
      }

      if (arg === "--provider" || arg.startsWith("--provider=")) {
        const result = readOptionValue(rest, index, "--provider");
        providerId = result.value;
        index = result.nextIndex;
        continue;
      }

      throw new StewardCliUsageError(`Unknown config set-steward option: ${arg}`);
    }

    if (providerId === undefined || providerId.trim() === "") {
      throw new StewardCliUsageError("config set-steward requires --provider");
    }

    return { kind: "configSetSteward", configPath, providerId };
  }

  throw new StewardCliUsageError("steward config requires a subcommand: show, init, or set-steward");
}

function parseProvidersCommand(argv: string[]): StewardCliCommand {
  const [subcommand, ...rest] = argv;

  if (subcommand === "list") {
    let configPath: string | undefined;
    for (let index = 0; index < rest.length; ) {
      const arg = rest[index];
      if (arg === "--config" || arg.startsWith("--config=")) {
        const result = parseConfigPathOption(rest, index);
        configPath = result.configPath;
        index = result.nextIndex;
        continue;
      }

      throw new StewardCliUsageError(`Unknown providers list option: ${arg}`);
    }

    return { kind: "providersList", configPath };
  }

  if (subcommand === "set") {
    let configPath: string | undefined;
    let id: string | undefined;
    let type: AgentProviderType | undefined;
    let commandTemplate: string | undefined;
    let defaultModel: string | null = null;
    let enabled = true;
    let priority = 100;
    let tags: string[] = [];
    let supportsLocal = true;
    let supportsRemote = true;

    for (let index = 0; index < rest.length; ) {
      const arg = rest[index];

      if (arg === "--config" || arg.startsWith("--config=")) {
        const result = parseConfigPathOption(rest, index);
        configPath = result.configPath;
        index = result.nextIndex;
        continue;
      }

      if (arg === "--id" || arg.startsWith("--id=")) {
        const result = readOptionValue(rest, index, "--id");
        id = result.value;
        index = result.nextIndex;
        continue;
      }

      if (arg === "--type" || arg.startsWith("--type=")) {
        const result = readOptionValue(rest, index, "--type");
        type = parseProviderType(result.value);
        index = result.nextIndex;
        continue;
      }

      if (arg === "--command" || arg.startsWith("--command=")) {
        const result = readOptionValue(rest, index, "--command");
        commandTemplate = result.value;
        index = result.nextIndex;
        continue;
      }

      if (arg === "--model" || arg.startsWith("--model=")) {
        const result = readOptionValue(rest, index, "--model");
        defaultModel = result.value;
        index = result.nextIndex;
        continue;
      }

      if (arg === "--priority" || arg.startsWith("--priority=")) {
        const result = readOptionValue(rest, index, "--priority");
        priority = parsePriority(result.value);
        index = result.nextIndex;
        continue;
      }

      if (arg === "--tags" || arg.startsWith("--tags=")) {
        const result = readOptionValue(rest, index, "--tags");
        tags = parseTags(result.value);
        index = result.nextIndex;
        continue;
      }

      if (arg === "--local" || arg.startsWith("--local=")) {
        const result = readOptionValue(rest, index, "--local");
        supportsLocal = parseBooleanValue(result.value, "--local");
        index = result.nextIndex;
        continue;
      }

      if (arg === "--remote" || arg.startsWith("--remote=")) {
        const result = readOptionValue(rest, index, "--remote");
        supportsRemote = parseBooleanValue(result.value, "--remote");
        index = result.nextIndex;
        continue;
      }

      if (arg === "--enabled" || arg.startsWith("--enabled=")) {
        const result = readOptionValue(rest, index, "--enabled");
        enabled = parseBooleanValue(result.value, "--enabled");
        index = result.nextIndex;
        continue;
      }

      throw new StewardCliUsageError(`Unknown providers set option: ${arg}`);
    }

    if (id === undefined || id.trim() === "") {
      throw new StewardCliUsageError("providers set requires --id");
    }

    if (type === undefined) {
      throw new StewardCliUsageError("providers set requires --type");
    }

    if (commandTemplate === undefined || commandTemplate.trim() === "") {
      throw new StewardCliUsageError("providers set requires --command");
    }

    return {
      kind: "providersSet",
      configPath,
      provider: {
        id,
        type,
        roles: ["worker"],
        commandProfiles: {
          default: {
            commandTemplate
          }
        },
        defaultCommandProfile: "default",
        defaultModel,
        enabled,
        priority,
        tags,
        supportsLocal,
        supportsRemote
      }
    };
  }

  if (subcommand === "enable" || subcommand === "disable") {
    let configPath: string | undefined;
    let providerId: string | undefined;
    for (let index = 0; index < rest.length; ) {
      const arg = rest[index];
      if (arg === "--config" || arg.startsWith("--config=")) {
        const result = parseConfigPathOption(rest, index);
        configPath = result.configPath;
        index = result.nextIndex;
        continue;
      }

      if (arg === "--id" || arg.startsWith("--id=")) {
        const result = readOptionValue(rest, index, "--id");
        providerId = result.value;
        index = result.nextIndex;
        continue;
      }

      throw new StewardCliUsageError(`Unknown providers ${subcommand} option: ${arg}`);
    }

    if (providerId === undefined || providerId.trim() === "") {
      throw new StewardCliUsageError(`providers ${subcommand} requires --id`);
    }

    return {
      kind: "providersToggle",
      configPath,
      providerId,
      enabled: subcommand === "enable"
    };
  }

  throw new StewardCliUsageError("steward providers requires a subcommand: list, set, enable, or disable");
}

export function parseStewardArgs(argv: string[], context: ParseStewardArgsContext): StewardCliCommand {
  if (argv.length === 0) {
    return parseChatOptions([], context);
  }

  const [command, ...rest] = argv;

  if (command === "chat") {
    return parseChatOptions(rest, context);
  }

  if (command === "status") {
    return parseStatusOptions(rest, context);
  }

  if (command === "serve") {
    if (rest.length > 0) {
      throw new StewardCliUsageError("steward serve does not accept options yet");
    }

    return { kind: "serve" };
  }

  if (command === "config") {
    return parseConfigCommand(rest);
  }

  if (command === "providers") {
    return parseProvidersCommand(rest);
  }

  if (command === "help" || command === "--help" || command === "-h") {
    return { kind: "help" };
  }

  if (command.startsWith("--")) {
    return parseChatOptions(argv, context);
  }

  throw new StewardCliUsageError(`Unknown command: ${command}`);
}
