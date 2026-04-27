import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

describe("docs version selector", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows latest docs as the default instead of the v0.1.0 archive title", () => {
    render(<App />);

    expect(screen.getByRole("combobox", { name: "Documentation version" })).toHaveValue("latest");
    expect(screen.getAllByRole("heading", { level: 1, name: "agent-fleet latest Docs" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1, name: "agent-fleet v0.1.0 Docs" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Latest docs track the current main branch.").length).toBeGreaterThan(0);
  });

  it("switches to a visibly versioned v0.1.0 docs archive", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Documentation version" }), "v0.1.0");

    expect(screen.getByRole("combobox", { name: "Documentation version" })).toHaveValue("v0.1.0");
    expect(screen.getAllByRole("heading", { level: 1, name: "agent-fleet v0.1.0 Docs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Version archive for the v0.1.0 release.").length).toBeGreaterThan(0);
    expect(window.location.search).toBe("?version=v0.1.0");
  });
});
