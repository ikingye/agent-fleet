import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function isCliEntrypoint(metaUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined || argvPath === "") {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return metaUrl === pathToFileURL(argvPath).href;
  }
}
