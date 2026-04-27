#!/usr/bin/env node
import process from "node:process";
import { isCliEntrypoint } from "./entrypoint.js";
import { runCli } from "./runCli.js";

export { runCli } from "./runCli.js";

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli();
}
