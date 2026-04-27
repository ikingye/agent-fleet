import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentFleetConfig,
  AgentProviderRole,
  AgentProviderType,
  StewardProviderConfig,
  WorkerKind,
  WorkerProviderConfig
} from "../../shared/types.js";
import { parseWorkerCommandArgs } from "../workers/commandWorkerAdapter.js";

export interface RenderedProviderCommand {
  command: string;
  args: string[];
  displayCommand: string;
  model: string | null;
}

export interface WorkerProviderSelectionInput {
  placement: "local" | "remote";
  requiredTags: string[];
}

const DEFAULT_PROVIDER_ID = "codexyoloproxy";
const DEFAULT_PROVIDER_TYPE: AgentProviderType = "codex";
const DEFAULT_COMMAND_TEMPLATE = "codexyoloproxy";
const TEMPLATE_PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function agentFleetConfigPath(cwd = process.cwd(), env: Record<string, string | undefined> = process.env): string {
  const override = normalizeOptionalString(env.AGENT_FLEET_CONFIG);
  if (override !== null) {
    return override;
  }

  const xdgConfigHome = normalizeOptionalString(env.XDG_CONFIG_HOME);
  if (xdgConfigHome !== null) {
    return join(xdgConfigHome, "agent-fleet", "config.json");
  }

  const home = normalizeOptionalString(env.HOME);
  return join(home ?? cwd, ".config", "agent-fleet", "config.json");
}

export function defaultAgentFleetConfig(): AgentFleetConfig {
  const stewardProvider: StewardProviderConfig = {
    id: DEFAULT_PROVIDER_ID,
    type: DEFAULT_PROVIDER_TYPE,
    roles: ["steward"],
    commandProfiles: {
      default: {
        commandTemplate: DEFAULT_COMMAND_TEMPLATE
      }
    },
    defaultCommandProfile: "default",
    defaultModel: null,
    enabled: true
  };

  return {
    version: 1,
    stewardProviderId: DEFAULT_PROVIDER_ID,
    stewardProvider,
    workerProviders: [
      {
        id: DEFAULT_PROVIDER_ID,
        type: DEFAULT_PROVIDER_TYPE,
        roles: ["worker"],
        commandProfiles: {
          default: {
            commandTemplate: DEFAULT_COMMAND_TEMPLATE
          }
        },
        defaultCommandProfile: "default",
        defaultModel: null,
        enabled: true,
        priority: 100,
        tags: [],
        supportsLocal: true,
        supportsRemote: true
      }
    ]
  };
}

export async function loadAgentFleetConfig(configPath: string): Promise<AgentFleetConfig> {
  const existingConfig = await readAgentFleetConfig(configPath);
  if (existingConfig !== null) {
    return existingConfig;
  }

  const config = defaultAgentFleetConfig();
  await saveAgentFleetConfig(configPath, config);
  return config;
}

export async function readAgentFleetConfig(configPath: string): Promise<AgentFleetConfig | null> {
  try {
    return normalizeAgentFleetConfig(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function saveAgentFleetConfig(configPath: string, config: AgentFleetConfig): Promise<AgentFleetConfig> {
  const normalized = normalizeAgentFleetConfig(config);

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`);

  return normalized;
}

export function normalizeAgentFleetConfig(raw: unknown): AgentFleetConfig {
  const defaults = defaultAgentFleetConfig();
  const record = objectRecord(raw);
  const rawStewardProvider = objectRecord(record.stewardProvider);
  const stewardProvider = normalizeStewardProvider({
    ...defaults.stewardProvider,
    ...rawStewardProvider
  });
  const rawProviders = Array.isArray(record.workerProviders) ? record.workerProviders : defaults.workerProviders;
  const workerProviders = rawProviders.map((provider) =>
    normalizeWorkerProvider({
      ...defaults.workerProviders[0],
      ...objectRecord(provider)
    })
  );
  const stewardProviderId = normalizeOptionalString(record.stewardProviderId) ?? stewardProvider.id;

  return {
    version: 1,
    stewardProviderId,
    stewardProvider,
    workerProviders: workerProviders.length === 0 ? defaults.workerProviders : workerProviders
  };
}

export function providerFromLegacyWorkerCommand(command: string, args: readonly string[] = []): WorkerProviderConfig {
  const normalizedCommand = normalizeRequiredString(command, "worker command");
  const parts = [normalizedCommand, ...args.map((arg) => String(arg))];

  return {
    id: "legacy-worker-command",
    type: providerTypeFromCommand(normalizedCommand),
    roles: ["worker"],
    commandProfiles: {
      default: {
        commandTemplate: parts.map(shellArg).join(" ")
      }
    },
    defaultCommandProfile: "default",
    defaultModel: null,
    enabled: true,
    priority: 1000,
    tags: [],
    supportsLocal: true,
    supportsRemote: true
  };
}

export function selectWorkerProvider(
  config: AgentFleetConfig,
  input: WorkerProviderSelectionInput
): WorkerProviderConfig | null {
  const requiredTags = normalizeTags(input.requiredTags);
  const candidates = config.workerProviders
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => {
      if (!provider.enabled) {
        return false;
      }

      if (!provider.roles.includes("worker")) {
        return false;
      }

      if (input.placement === "local" && !provider.supportsLocal) {
        return false;
      }

      if (input.placement === "remote" && !provider.supportsRemote) {
        return false;
      }

      if (provider.tags.length === 0) {
        return true;
      }

      const providerTags = new Set(provider.tags);
      return requiredTags.every((tag) => providerTags.has(tag));
    });

  candidates.sort((left, right) => {
    return (
      right.provider.priority - left.provider.priority ||
      right.provider.tags.length - left.provider.tags.length ||
      left.index - right.index
    );
  });

  return candidates[0]?.provider ?? null;
}

export function renderProviderCommand(provider: WorkerProviderConfig | StewardProviderConfig): RenderedProviderCommand {
  const normalizedProvider =
    "priority" in provider ? normalizeWorkerProvider(provider) : normalizeStewardProvider(provider);
  const commandTemplate = commandTemplateForProvider(normalizedProvider);
  const parts = parseWorkerCommandArgs(commandTemplate);

  if (parts.length === 0) {
    throw new Error(`Provider ${normalizedProvider.id} commandTemplate must include a command`);
  }

  const renderedParts: string[] = [];
  for (const part of parts) {
    const rendered = renderTemplatePart(part, normalizedProvider);

    if (rendered === null) {
      if (renderedParts.at(-1) === "--model") {
        renderedParts.pop();
      }
      continue;
    }

    renderedParts.push(rendered);
  }

  if (renderedParts.length === 0) {
    throw new Error(`Provider ${normalizedProvider.id} commandTemplate rendered to an empty command`);
  }

  return {
    command: renderedParts[0],
    args: renderedParts.slice(1),
    displayCommand: renderedParts.map(shellArg).join(" "),
    model: normalizedProvider.defaultModel
  };
}

export function workerKindForProviderType(type: AgentProviderType): WorkerKind {
  return type;
}

function normalizeStewardProvider(raw: Record<string, unknown> | StewardProviderConfig): StewardProviderConfig {
  const commandProfiles = normalizeCommandProfiles(raw);

  return {
    id: normalizeRequiredString(raw.id, "provider id"),
    type: normalizeProviderType(raw.type),
    roles: normalizeRoles(raw.roles),
    commandProfiles,
    defaultCommandProfile: normalizeDefaultCommandProfile(raw.defaultCommandProfile, commandProfiles),
    defaultModel: normalizeOptionalString(raw.defaultModel),
    enabled: raw.enabled === undefined ? true : normalizeBoolean(raw.enabled, "enabled")
  };
}

function normalizeWorkerProvider(raw: Record<string, unknown> | WorkerProviderConfig): WorkerProviderConfig {
  return {
    ...normalizeStewardProvider(raw),
    priority: normalizePriority(raw.priority),
    tags: normalizeTags(raw.tags),
    supportsLocal: raw.supportsLocal === undefined ? true : normalizeBoolean(raw.supportsLocal, "supportsLocal"),
    supportsRemote: raw.supportsRemote === undefined ? true : normalizeBoolean(raw.supportsRemote, "supportsRemote")
  };
}

function renderTemplatePart(part: string, provider: StewardProviderConfig): string | null {
  const model = normalizeOptionalString(provider.defaultModel);
  const replacements: Record<string, string | null> = {
    model,
    providerId: provider.id,
    providerType: provider.type
  };
  let missingModel = false;
  const rendered = part.replace(TEMPLATE_PLACEHOLDER_PATTERN, (match, name: string) => {
    if (!(name in replacements)) {
      throw new Error(`Unsupported provider command placeholder: ${match}`);
    }

    const replacement = replacements[name];
    if (replacement === null) {
      missingModel = name === "model";
      return "";
    }

    return replacement;
  });

  if (missingModel && rendered.trim() === "") {
    return null;
  }

  if (missingModel && part.includes("{model}")) {
    return null;
  }

  return rendered;
}

function commandTemplateForProvider(provider: StewardProviderConfig): string {
  const profile = provider.commandProfiles[provider.defaultCommandProfile];

  if (profile === undefined) {
    throw new Error(`Provider ${provider.id} defaultCommandProfile is missing: ${provider.defaultCommandProfile}`);
  }

  return profile.commandTemplate;
}

function normalizeCommandProfiles(
  raw: Record<string, unknown> | StewardProviderConfig
): Record<string, { commandTemplate: string }> {
  const legacyCommandTemplate = normalizeOptionalString("commandTemplate" in raw ? raw.commandTemplate : undefined);
  if (legacyCommandTemplate !== null) {
    return {
      default: {
        commandTemplate: legacyCommandTemplate
      }
    };
  }

  const record = objectRecord("commandProfiles" in raw ? raw.commandProfiles : undefined);
  const entries = Object.entries(record)
    .map(([name, profile]) => {
      const profileRecord = objectRecord(profile);
      const normalizedName = name.trim();

      if (normalizedName === "") {
        throw new Error("commandProfiles keys must be non-empty strings");
      }

      return [
        normalizedName,
        {
          commandTemplate: normalizeRequiredString(profileRecord.commandTemplate, `commandProfiles.${normalizedName}.commandTemplate`)
        }
      ] as const;
    });

  if (entries.length > 0) {
    return Object.fromEntries(entries);
  }

  throw new Error("commandProfiles must define at least one command profile");
}

function normalizeDefaultCommandProfile(
  value: unknown,
  commandProfiles: Record<string, { commandTemplate: string }>
): string {
  const normalized = normalizeOptionalString(value) ?? "default";

  if (commandProfiles[normalized] === undefined) {
    throw new Error(`defaultCommandProfile must reference an existing command profile: ${normalized}`);
  }

  return normalized;
}

function normalizeRoles(value: unknown): AgentProviderRole[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("roles must be an array of steward/worker strings");
  }

  const roles = [
    ...new Set(
      value.map((role) => {
        if (role !== "steward" && role !== "worker") {
          throw new Error("roles must contain only steward or worker");
        }

        return role;
      })
    )
  ];

  return roles;
}

function providerTypeFromCommand(command: string): AgentProviderType {
  const lowerCommand = command.toLowerCase();

  if (lowerCommand.includes("claude")) {
    return "claude";
  }

  if (lowerCommand.includes("gemini")) {
    return "gemini";
  }

  if (lowerCommand.includes("codex")) {
    return "codex";
  }

  return "custom";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeProviderType(value: unknown): AgentProviderType {
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

  throw new Error("provider type must be one of: codex, claude, gemini, custom (legacy aliases: claude_code, gemini_cli)");
}

function normalizeRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeBoolean(value: unknown, name: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${name} must be a boolean`);
}

function normalizePriority(value: unknown): number {
  if (value === undefined || value === null) {
    return 100;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("priority must be a finite number");
  }

  return Math.floor(value);
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("tags must be an array of strings");
  }

  return [
    ...new Set(
      value
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag !== "")
    )
  ];
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
