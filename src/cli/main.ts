#!/usr/bin/env node
import process from "node:process";
import { createStewardApiClient } from "./apiClient.js";
import { parseStewardArgs, StewardCliUsageError } from "./args.js";
import { isCliEntrypoint } from "./entrypoint.js";
import { formatStatusSummary, runInteractiveChat } from "./readlineChat.js";

interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

const usage = `Usage:
  steward
  steward chat --workspace <path> [--project <name>] [--api-url <url>] [--once <message>] [--json]
  steward status [--api-url <url>]
  steward serve

Commands:
  chat      Open an interactive Steward chat, or send one message with --once.
  status    Show API health and recovery summary.
  serve     Start the built agent-fleet API server.
`;

function writeError(stderr: NodeJS.WriteStream, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
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

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli();
}
