import { describe, expect, it } from "vitest";
import type { RemoteHost } from "../../shared/types.js";
import type { CommandRunner } from "../services/commandRunner.js";
import { buildProxyEnvironment, hasLoopbackProxyForward, RemoteHostProbe } from "./remoteHostProbe.js";

const remoteHost: RemoteHost = {
  id: "remote-1",
  name: "remote-dev",
  sshHost: "remote-dev",
  workRoot: "/root/code/project",
  proxyMode: "auto",
  proxyUrl: "http://127.0.0.1:1080",
  localForwardPort: 8788,
  createdAt: "2026-04-25T00:00:00.000Z",
  updatedAt: "2026-04-25T00:00:00.000Z"
};

describe("remoteHostProbe", () => {
  it("detects a reverse-forwarded loopback proxy from ssh -G output", () => {
    expect(
      hasLoopbackProxyForward(`
hostname 203.0.113.10
user ubuntu
remoteforward [127.0.0.1]:1080 [127.0.0.1]:1080
`)
    ).toBe(true);
  });

  it("builds proxy environment only when the host is configured to use a proxy", () => {
    expect(buildProxyEnvironment({ proxyMode: "direct", proxyUrl: "http://127.0.0.1:1080" })).toEqual({});
    expect(buildProxyEnvironment({ proxyMode: "auto", proxyUrl: "http://127.0.0.1:1080" })).toEqual({});
    expect(buildProxyEnvironment({ proxyMode: "http_proxy", proxyUrl: "http://127.0.0.1:1080" })).toEqual({
      HTTP_PROXY: "http://127.0.0.1:1080",
      HTTPS_PROXY: "http://127.0.0.1:1080",
      NO_PROXY: "localhost,127.0.0.1,::1"
    });
  });

  it("checks ssh, toolchain, direct github access, and proxy fallback without proxying every domain", async () => {
    const calls: string[] = [];
    const runner: CommandRunner = {
      async run(command, args) {
        calls.push([command, ...args].join(" "));
        const commandText = args.at(-1) ?? "";

        if (args.includes("-G")) {
          return {
            exitCode: 0,
            stdout: "remoteforward [127.0.0.1]:1080 [127.0.0.1]:1080\n",
            stderr: ""
          };
        }

        if (commandText === "uname -s") {
          return { exitCode: 0, stdout: "Linux\n", stderr: "" };
        }

        if (commandText.includes("command -v git") && commandText.includes("command -v codex")) {
          return { exitCode: 0, stdout: "/usr/bin/git\n/opt/node/bin/node\n/usr/local/bin/codex\n", stderr: "" };
        }

        if (commandText.includes("https://api.github.com/rate_limit") && !commandText.includes("HTTPS_PROXY=")) {
          return { exitCode: 28, stdout: "", stderr: "timeout" };
        }

        if (commandText.includes("HTTPS_PROXY=http://127.0.0.1:1080")) {
          return { exitCode: 0, stdout: "HTTP/2 200\n", stderr: "" };
        }

        return { exitCode: 0, stdout: "HTTP/2 200\n", stderr: "" };
      }
    };

    const diagnostics = await new RemoteHostProbe(runner).check(remoteHost);

    expect(diagnostics.checks.map((check) => [check.name, check.status])).toEqual([
      ["ssh_config", "passed"],
      ["ssh_connectivity", "passed"],
      ["remote_toolchain", "passed"],
      ["npm_registry_direct", "passed"],
      ["github_direct", "warning"],
      ["github_proxy", "passed"],
      ["openai_proxy", "passed"],
      ["google_proxy", "passed"]
    ]);
    expect(calls.some((call) => call.includes("registry.npmjs.org") && !call.includes("HTTPS_PROXY="))).toBe(true);
    expect(diagnostics.recommendedEnvironment).toEqual({});
  });
});
