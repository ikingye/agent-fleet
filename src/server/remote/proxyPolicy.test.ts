import { describe, expect, it } from "vitest";
import { chooseNetworkRoute } from "./proxyPolicy.js";

describe("chooseNetworkRoute", () => {
  it("uses direct routing for mainland domains", () => {
    expect(
      chooseNetworkRoute({
        hostname: "baidu.com",
        proxyUrl: "http://127.0.0.1:1080"
      })
    ).toEqual({
      mode: "direct",
      proxyUrl: null,
      reason: "domain is configured for direct remote access"
    });
  });

  it("uses the forwarded proxy for configured global domains", () => {
    expect(
      chooseNetworkRoute({
        hostname: "google.com",
        proxyUrl: "http://127.0.0.1:1080"
      })
    ).toEqual({
      mode: "proxy",
      proxyUrl: "http://127.0.0.1:1080",
      reason: "domain is configured for proxy fallback"
    });
  });

  it("uses direct routing when no proxy is configured", () => {
    expect(chooseNetworkRoute({ hostname: "github.com", proxyUrl: null })).toEqual({
      mode: "direct",
      proxyUrl: null,
      reason: "no proxy configured"
    });
  });

  it("keeps unconfigured domains direct even when a proxy is available", () => {
    expect(
      chooseNetworkRoute({
        hostname: "example.com",
        proxyUrl: "http://127.0.0.1:1080"
      })
    ).toEqual({
      mode: "direct",
      proxyUrl: null,
      reason: "default direct route"
    });
  });

  it("matches configured subdomains case-insensitively", () => {
    expect(
      chooseNetworkRoute({
        hostname: "WWW.YouTube.com",
        proxyUrl: "http://127.0.0.1:1080"
      })
    ).toEqual({
      mode: "proxy",
      proxyUrl: "http://127.0.0.1:1080",
      reason: "domain is configured for proxy fallback"
    });
  });
});
