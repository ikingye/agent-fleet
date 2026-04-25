import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  it("renders the Task 1 dashboard shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "agent-fleet" })).toBeInTheDocument();
    expect(screen.getByText("Local Orchestrator")).toBeInTheDocument();
    expect(screen.getByText("MVP")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Fleet dashboard" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Task queue, agent runs, worktrees, checks, review, merge, and push status will appear here."
      )
    ).toBeInTheDocument();
  });
});
