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

  it("rejects options without values", () => {
    expect(() => parseStewardArgs(["chat", "--workspace"], parseContext)).toThrow("--workspace requires a value");
  });
});
