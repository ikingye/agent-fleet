export interface ChooseNetworkRouteInput {
  hostname: string;
  proxyUrl: string | null;
}

export interface NetworkRoute {
  mode: "direct" | "proxy";
  proxyUrl: string | null;
  reason: string;
}

const DIRECT_DOMAINS = ["baidu.com", "bilibili.com", "qq.com", "taobao.com", "tmall.com", "zhihu.com"];
const PROXY_DOMAINS = ["anthropic.com", "google.com", "openai.com", "twitter.com", "x.com", "youtube.com"];

export function chooseNetworkRoute(input: ChooseNetworkRouteInput): NetworkRoute {
  const hostname = normalizeHostname(input.hostname);

  if (matchesDomain(hostname, DIRECT_DOMAINS)) {
    return {
      mode: "direct",
      proxyUrl: null,
      reason: "domain is configured for direct remote access"
    };
  }

  if (input.proxyUrl === null || input.proxyUrl.trim() === "") {
    return {
      mode: "direct",
      proxyUrl: null,
      reason: "no proxy configured"
    };
  }

  if (matchesDomain(hostname, PROXY_DOMAINS)) {
    return {
      mode: "proxy",
      proxyUrl: input.proxyUrl,
      reason: "domain is configured for proxy fallback"
    };
  }

  return {
    mode: "direct",
    proxyUrl: null,
    reason: "default direct route"
  };
}

function matchesDomain(hostname: string, domains: string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}
