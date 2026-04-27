import { describe, expect, it } from "vitest";
import { evaluateRemoteNodeReadiness } from "./remoteNodeReadiness.js";

describe("evaluateRemoteNodeReadiness", () => {
  it("marks a configured ready remote node as usable", () => {
    expect(
      evaluateRemoteNodeReadiness({
        status: "ready",
        sshHost: "builder-1",
        workRoot: "/srv/agent-fleet",
        proxyUrl: null,
        proxyRequired: false
      })
    ).toEqual({
      ready: true,
      reasons: []
    });
  });

  it("reports missing remote node prerequisites without probing the network", () => {
    expect(
      evaluateRemoteNodeReadiness({
        status: "unknown",
        sshHost: null,
        workRoot: "relative/work",
        proxyUrl: " ",
        proxyRequired: true
      })
    ).toEqual({
      ready: false,
      reasons: [
        "node status is unknown",
        "ssh host is required",
        "work root must be an absolute path",
        "proxy url is required"
      ]
    });
  });
});
