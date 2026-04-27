import { describe, expect, it } from "vitest";
import { buildDocsPages } from "./content.js";

describe("docs content versions", () => {
  it("keeps latest docs visibly separate from the v0.1.0 snapshot", () => {
    const latestHome = buildDocsPages("latest").find((page) => page.slug === "home");
    const releaseHome = buildDocsPages("v0.1.0").find((page) => page.slug === "home");

    expect(latestHome?.title).toBe("agent-fleet latest Docs");
    expect(latestHome?.body).toContain("# agent-fleet latest Docs");
    expect(latestHome?.body).not.toContain("# agent-fleet v0.1.0 Docs");

    expect(releaseHome?.title).toBe("agent-fleet v0.1.0 Docs");
    expect(releaseHome?.body).toContain("# agent-fleet v0.1.0 Docs");
    expect(releaseHome?.body).toContain("Version archive for the v0.1.0 release.");
    expect(releaseHome?.body).not.toContain("Latest docs track the current main branch.");
  });
});
