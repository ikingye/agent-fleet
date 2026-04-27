import { access } from "node:fs/promises";
import process from "node:process";
import { createStewardApiClient } from "./apiClient.js";
import { parseStewardArgs, StewardCliUsageError } from "./args.js";
import { formatStatusSummary, runInteractiveChat } from "./readlineChat.js";
import {
  agentFleetConfigPath,
  defaultAgentFleetConfig,
  loadAgentFleetConfig,
  saveAgentFleetConfig
} from "../server/providers/agentProviderConfig.js";
import type { AgentFleetConfig, AgentProviderRole, StewardProviderConfig, WorkerProviderConfig } from "../shared/types.js";

export interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

const usage = `Usage:
  steward
  steward chat --workspace <path> [--project <name>] [--api-url <url>] [--once <message>] [--json]
  steward status [--api-url <url>]
  steward config show [--config <path>]
  steward config init [--config <path>] [--force]
  steward config set-steward --provider <id> [--config <path>]
  steward providers list [--config <path>]
  steward providers set --id <id> --type <codex|claude|gemini|custom> --command <template> [--model <model>] [--priority <n>] [--tags a,b] [--local true|false] [--remote true|false] [--enabled true|false] [--config <path>]
  steward providers enable --id <id> [--config <path>]
  steward providers disable --id <id> [--config <path>]
  steward serve

Commands:
  chat       Open an interactive Steward chat, or send one message with --once.
  status     Show API health and recovery summary.
  config     Show or initialize local provider config.
  providers  List or change Worker agent providers.
  serve      Start the built agent-fleet API server.
`;

function writeError(stderr: NodeJS.WriteStream, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function startServer(stderr: NodeJS.WriteStream): Promise<number> {
  try {
    await import("../server/main.js");
    return 0;
  } catch (error) {
    try {
      const sourceServerEntry = "../server/main" + ".ts";
      await import(sourceServerEntry);
      return 0;
    } catch {
      stderr.write(
        `Unable to start the agent-fleet server from this install. Run "npm run dev:server" from the repository or reinstall after "npm run build".\n`
      );
      writeError(stderr, error);
      return 1;
    }
  }
}

function resolveConfigPath(commandConfigPath: string | undefined, cwd: string, env: Record<string, string | undefined>): string {
  return commandConfigPath ?? agentFleetConfigPath(cwd, env);
}

function providerLine(provider: WorkerProviderConfig): string {
  return [
    provider.id,
    provider.type,
    provider.enabled ? "enabled" : "disabled",
    `priority=${provider.priority}`,
    `model=${provider.defaultModel ?? "-"}`,
    `tags=${provider.tags.join(",") || "-"}`,
    `local=${provider.supportsLocal}`,
    `remote=${provider.supportsRemote}`,
    provider.commandProfiles[provider.defaultCommandProfile]?.commandTemplate ?? "-"
  ].join("  ");
}

function workerProviderAsStewardProvider(provider: WorkerProviderConfig): StewardProviderConfig {
  return {
    id: provider.id,
    type: provider.type,
    roles: [...new Set<AgentProviderRole>([...provider.roles, "steward"])],
    commandProfiles: provider.commandProfiles,
    defaultCommandProfile: provider.defaultCommandProfile,
    defaultModel: provider.defaultModel,
    enabled: provider.enabled
  };
}

function isWorkerProvider(provider: StewardProviderConfig | WorkerProviderConfig): provider is WorkerProviderConfig {
  return "priority" in provider && "tags" in provider && "supportsLocal" in provider && "supportsRemote" in provider;
}

async function runConfigCommand(
  command: Extract<ReturnType<typeof parseStewardArgs>, { kind: "configShow" | "configInit" | "configSetSteward" }>,
  env: Record<string, string | undefined>,
  cwd: string,
  io: CliIo
): Promise<number> {
  const configPath = resolveConfigPath(command.configPath, cwd, env);

  if (command.kind === "configShow") {
    io.stdout.write(`${JSON.stringify(await loadAgentFleetConfig(configPath), null, 2)}\n`);
    return 0;
  }

  if (command.kind === "configInit") {
    if (!command.force && (await pathExists(configPath))) {
      io.stderr.write(`Config already exists at ${configPath}. Use --force to overwrite it.\n`);
      return 1;
    }

    await saveAgentFleetConfig(configPath, defaultAgentFleetConfig());
    io.stdout.write(`Wrote provider config to ${configPath}\n`);
    return 0;
  }

  const config = await loadAgentFleetConfig(configPath);
  const provider =
    config.workerProviders.find((item) => item.id === command.providerId) ??
    (config.stewardProvider.id === command.providerId ? config.stewardProvider : null);

  if (provider === null) {
    io.stderr.write(`Provider not found: ${command.providerId}\n`);
    return 1;
  }

  config.stewardProviderId = provider.id;
  config.stewardProvider = isWorkerProvider(provider) ? workerProviderAsStewardProvider(provider) : provider;
  await saveAgentFleetConfig(configPath, config);
  io.stdout.write(`Set Steward provider to ${provider.id}\n`);
  return 0;
}

async function runProvidersCommand(
  command: Extract<ReturnType<typeof parseStewardArgs>, { kind: "providersList" | "providersSet" | "providersToggle" }>,
  env: Record<string, string | undefined>,
  cwd: string,
  io: CliIo
): Promise<number> {
  const configPath = resolveConfigPath(command.configPath, cwd, env);
  const config = await loadAgentFleetConfig(configPath);

  if (command.kind === "providersList") {
    io.stdout.write(`Steward provider: ${config.stewardProviderId}\n`);
    for (const provider of config.workerProviders) {
      io.stdout.write(`${providerLine(provider)}\n`);
    }
    return 0;
  }

  if (command.kind === "providersSet") {
    const index = config.workerProviders.findIndex((provider) => provider.id === command.provider.id);
    if (index === -1) {
      config.workerProviders.push(command.provider);
    } else {
      config.workerProviders[index] = command.provider;
    }
    await saveAgentFleetConfig(configPath, config);
    io.stdout.write(`Saved Worker provider ${command.provider.id}\n`);
    return 0;
  }

  const provider = config.workerProviders.find((item) => item.id === command.providerId);
  if (provider === undefined) {
    io.stderr.write(`Provider not found: ${command.providerId}\n`);
    return 1;
  }

  provider.enabled = command.enabled;
  await saveAgentFleetConfig(configPath, config);
  io.stdout.write(`${command.enabled ? "Enabled" : "Disabled"} Worker provider ${provider.id}\n`);
  return 0;
}

export async function runCli(
  argv = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
  io: CliIo = process
): Promise<number> {
  let command;

  try {
    command = parseStewardArgs(argv, { cwd, env });
  } catch (error) {
    if (error instanceof StewardCliUsageError) {
      io.stderr.write(`${error.message}\n\n${usage}`);
      return 1;
    }

    throw error;
  }

  if (command.kind === "help") {
    io.stdout.write(usage);
    return 0;
  }

  if (command.kind === "serve") {
    return startServer(io.stderr);
  }

  if (command.kind === "configShow" || command.kind === "configInit" || command.kind === "configSetSteward") {
    return runConfigCommand(command, env, cwd, io);
  }

  if (command.kind === "providersList" || command.kind === "providersSet" || command.kind === "providersToggle") {
    return runProvidersCommand(command, env, cwd, io);
  }

  const client = createStewardApiClient({
    apiUrl: command.apiUrl,
    env
  });

  if (command.kind === "status") {
    try {
      io.stdout.write(`${formatStatusSummary(await client.fetchStatus())}\n`);
      return 0;
    } catch (error) {
      writeError(io.stderr, error);
      return 1;
    }
  }

  if (command.once !== undefined) {
    try {
      const response = await client.sendStewardMessage({
        body: command.once,
        workspacePath: command.workspacePath,
        projectName: command.projectName
      });

      io.stdout.write(command.json ? `${JSON.stringify(response)}\n` : `Steward: ${response.stewardMessage.body}\n`);
      return 0;
    } catch (error) {
      writeError(io.stderr, error);
      return 1;
    }
  }

  await runInteractiveChat({
    input: io.stdin,
    output: io.stdout,
    client,
    apiUrl: command.apiUrl,
    workspacePath: command.workspacePath,
    projectName: command.projectName,
    json: command.json
  });

  return 0;
}

export { usage as stewardCliUsage };
