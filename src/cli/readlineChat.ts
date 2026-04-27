import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { StewardApiClient, StewardStatusSummary } from "./apiClient.js";

export interface InteractiveChatOptions {
  input: Readable;
  output: Writable;
  client: StewardApiClient;
  apiUrl: string;
  workspacePath: string;
  projectName: string | undefined;
  json?: boolean;
}

function writeLine(output: Writable, line = ""): void {
  output.write(`${line}\n`);
}

export function dashboardUrlFromApiUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);

    if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "8787") {
      url.port = "5173";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return "Start the web app with npm run dev and open the Vite URL.";
  }

  return "Start the web app with npm run dev and open the Vite URL.";
}

export function formatStatusSummary(status: StewardStatusSummary): string {
  const lines = [
    `API: ${status.healthy ? "ok" : "unhealthy"} (${status.apiUrl})`,
    `Active goals: ${status.activeGoalsCount}`,
    `Active Worker sessions: ${status.activeWorkerSessionsCount}`
  ];

  if (status.lastCheckpointSummary) {
    lines.push(`Last checkpoint: ${status.lastCheckpointSummary}`);
  }

  if (status.nextActions.length > 0) {
    lines.push("Next actions:");
    lines.push(...status.nextActions.map((action) => `- ${action}`));
  }

  return lines.join("\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTty(output: Writable): boolean {
  return (output as Writable & { isTTY?: boolean }).isTTY === true;
}

export async function runInteractiveChat(options: InteractiveChatOptions): Promise<void> {
  let workspacePath = options.workspacePath;
  let projectName = options.projectName;
  const terminal = isTty(options.output);
  const readline = createInterface({
    input: options.input,
    output: terminal ? options.output : undefined,
    terminal
  });

  writeLine(options.output, "Steward CLI");
  writeLine(options.output, `Workspace: ${workspacePath}`);
  writeLine(options.output, `Project: ${projectName ?? "(none)"}`);
  writeLine(options.output, "Type /quit to exit.");

  if (terminal) {
    readline.setPrompt("steward> ");
    readline.prompt();
  }

  for await (const rawLine of readline) {
    const line = rawLine.trim();

    if (line === "") {
      if (terminal) {
        readline.prompt();
      }

      continue;
    }

    if (line === "/quit" || line === "/exit") {
      writeLine(options.output, "Goodbye.");
      break;
    }

    if (line === "/help") {
      writeLine(options.output, "Commands: /workspace [path], /project [name], /status, /web, /quit");
    } else if (line === "/status") {
      try {
        writeLine(options.output, formatStatusSummary(await options.client.fetchStatus()));
      } catch (error) {
        writeLine(options.output, `Error: ${formatError(error)}`);
      }
    } else if (line === "/web") {
      writeLine(options.output, `Dashboard: ${dashboardUrlFromApiUrl(options.apiUrl)}`);
    } else if (line.startsWith("/workspace")) {
      const nextWorkspace = line.slice("/workspace".length).trim();

      if (nextWorkspace !== "") {
        workspacePath = nextWorkspace;
      }

      writeLine(options.output, `Workspace: ${workspacePath}`);
    } else if (line.startsWith("/project")) {
      const nextProject = line.slice("/project".length).trim();

      if (nextProject !== "") {
        projectName = nextProject;
      }

      writeLine(options.output, `Project: ${projectName ?? "(none)"}`);
    } else if (line.startsWith("/")) {
      writeLine(options.output, `Unknown command: ${line}`);
    } else {
      try {
        const response = await options.client.sendStewardMessage({
          body: line,
          workspacePath,
          projectName
        });

        if (options.json) {
          writeLine(options.output, JSON.stringify(response));
        } else {
          writeLine(options.output, `Steward: ${response.stewardMessage.body}`);
        }
      } catch (error) {
        writeLine(options.output, `Error: ${formatError(error)}`);
      }
    }

    if (terminal) {
      readline.prompt();
    }
  }

  readline.close();
}
