import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ repositories: [], tasks: [] })
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the local fleet dashboard", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "agent-fleet" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Task Queue" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument();
  });

  it("shows an error when queueing a task without a repository", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Queue task" }));

    expect(
      screen.getByText("Register a repository before creating tasks.")
    ).toBeInTheDocument();
  });
});
