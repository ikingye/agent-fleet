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

  if (command === "help" || command === "--help" || command === "-h") {
    return { kind: "help" };
  }

  if (command.startsWith("--")) {
    return parseChatOptions(argv, context);
  }

  throw new StewardCliUsageError(`Unknown command: ${command}`);
}
