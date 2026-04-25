import type {
  RemoteCheckStatus,
  RemoteHost,
  RemoteHostCheck,
  RemoteHostDiagnostics,
  RemoteProxyMode
} from "../../shared/types.js";
import type { CommandResult, CommandRunner } from "../services/commandRunner.js";

interface ProxyEnvironmentInput {
  proxyMode: RemoteProxyMode;
  proxyUrl: string | null;
}

function checkFromResult(
  name: string,
  passedMessage: string,
  failedMessage: string,
  result: CommandResult,
  failedStatus: RemoteCheckStatus = "failed"
): RemoteHostCheck {
  const output = `${result.stdout}${result.stderr}`.trim();

  return {
    name,
    status: result.exitCode === 0 ? "passed" : failedStatus,
    message: result.exitCode === 0 ? passedMessage : failedMessage,
    output
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function proxyPrefix(proxyUrl: string): string {
  const quotedProxy = shellQuote(proxyUrl);

  return `HTTP_PROXY=${quotedProxy} HTTPS_PROXY=${quotedProxy} NO_PROXY='localhost,127.0.0.1,::1' `;
}

export function hasLoopbackProxyForward(sshConfigOutput: string): boolean {
  return sshConfigOutput
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .some((line) => line.startsWith("remoteforward ") && line.includes("127.0.0.1") && line.includes("1080"));
}

export function buildProxyEnvironment(input: ProxyEnvironmentInput): Record<string, string> {
  if (input.proxyMode !== "http_proxy" || input.proxyUrl === null) {
    return {};
  }

  return {
    HTTP_PROXY: input.proxyUrl,
    HTTPS_PROXY: input.proxyUrl,
    NO_PROXY: "localhost,127.0.0.1,::1"
  };
}

function shouldRunProxyChecks(host: RemoteHost): host is RemoteHost & { proxyUrl: string } {
  return host.proxyMode !== "direct" && host.proxyUrl !== null;
}

export class RemoteHostProbe {
  constructor(private runner: CommandRunner) {}

  async check(host: RemoteHost): Promise<RemoteHostDiagnostics> {
    const checks: RemoteHostCheck[] = [];
    const sshConfig = await this.runner.run("ssh", ["-G", host.sshHost], { cwd: process.cwd() });
    const hasProxyForward = sshConfig.exitCode === 0 && hasLoopbackProxyForward(sshConfig.stdout);

    checks.push({
      name: "ssh_config",
      status: sshConfig.exitCode === 0 && (host.proxyMode === "direct" || hasProxyForward) ? "passed" : "warning",
      message:
        host.proxyMode === "direct" || hasProxyForward
          ? "SSH config is readable and includes the expected reverse proxy forward when needed."
          : "SSH config is readable, but RemoteForward 127.0.0.1:1080 was not detected.",
      output: `${sshConfig.stdout}${sshConfig.stderr}`.trim()
    });

    const sshConnectivity = await this.runRemote(host, "uname -s");
    checks.push(
      checkFromResult("ssh_connectivity", "SSH connectivity is available.", "SSH connectivity failed.", sshConnectivity)
    );

    if (sshConnectivity.exitCode !== 0) {
      return {
        host,
        checks,
        recommendedEnvironment: buildProxyEnvironment(host),
        checkedAt: new Date().toISOString()
      };
    }

    checks.push(
      checkFromResult(
        "remote_toolchain",
        "Remote git, node, and codex commands are available.",
        "Remote git, node, or codex command is missing.",
        await this.runRemote(host, "command -v git && command -v node && command -v codex")
      )
    );
    checks.push(
      checkFromResult(
        "npm_registry_direct",
        "npm registry is reachable directly from the remote host.",
        "npm registry direct access failed.",
        await this.runRemote(host, "curl -I --max-time 8 https://registry.npmjs.org/")
      )
    );
    const canUseProxyFallback = shouldRunProxyChecks(host);

    checks.push(
      checkFromResult(
        "github_direct",
        "GitHub API is reachable directly from the remote host.",
        "GitHub API direct access failed; proxy fallback may be needed.",
        await this.runRemote(host, "curl -I --max-time 8 https://api.github.com/rate_limit"),
        canUseProxyFallback ? "warning" : "failed"
      )
    );

    if (canUseProxyFallback) {
      const proxiedChecks: Array<[name: string, messageTarget: string, url: string]> = [
        ["github_proxy", "GitHub API", "https://api.github.com/rate_limit"],
        ["openai_proxy", "OpenAI API", "https://api.openai.com/v1/models"],
        ["google_proxy", "Google connectivity", "https://www.google.com/generate_204"]
      ];

      for (const [name, messageTarget, url] of proxiedChecks) {
        checks.push(
          checkFromResult(
            name,
            `${messageTarget} is reachable through the forwarded local proxy.`,
            `${messageTarget} proxy access failed.`,
            await this.runRemote(host, `${proxyPrefix(host.proxyUrl)}curl -I --max-time 12 ${shellQuote(url)}`)
          )
        );
      }
    }

    return {
      host,
      checks,
      recommendedEnvironment: buildProxyEnvironment(host),
      checkedAt: new Date().toISOString()
    };
  }

  private runRemote(host: RemoteHost, command: string): Promise<CommandResult> {
    return this.runner.run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host.sshHost, command], {
      cwd: process.cwd()
    });
  }
}
