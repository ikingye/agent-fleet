const MACOS_MALLOC_STACK_LOGGING_NOISE =
  /^\s*codex\(\d+\)\s+MallocStackLogging:\s+can't turn off malloc stack logging because it was not enabled\.\s*$/;

export function filterKnownPlatformNoise(value: string): string {
  if (!value.includes("MallocStackLogging")) {
    return value;
  }

  return value
    .split(/\r?\n/)
    .filter((line) => !MACOS_MALLOC_STACK_LOGGING_NOISE.test(line))
    .join("\n");
}
