import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHost, RemoteHostDiagnostics } from "../shared/types.js";
import { App } from "./App.js";

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

function jsonResponse(value: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(value)
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ repositories: [], tasks: [], remoteHosts: [] })
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

  it("renders remote node management", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: "Remote Nodes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add remote node" })).toBeInTheDocument();
    expect(screen.getByText("No remote execution nodes registered.")).toBeInTheDocument();
  });

  it("shows an error when queueing a task without a repository", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Queue task" }));

    expect(
      screen.getByText("Register a repository before creating tasks.")
    ).toBeInTheDocument();
  });

  it("creates a remote host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ repositories: [], tasks: [], remoteHosts: [] }))
      .mockResolvedValueOnce(jsonResponse(remoteHost))
      .mockResolvedValueOnce(jsonResponse({ repositories: [], tasks: [], remoteHosts: [remoteHost] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Node name"), "remote-dev");
    await user.type(screen.getByLabelText("SSH host"), "remote-dev");
    await user.type(screen.getByLabelText("Work root"), "/root/code/project");
    await user.type(screen.getByLabelText("Local forward port"), "8788");
    await user.click(screen.getByRole("button", { name: "Add remote node" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/remote-hosts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "remote-dev",
          sshHost: "remote-dev",
          workRoot: "/root/code/project",
          proxyMode: "auto",
          proxyUrl: "http://127.0.0.1:1080",
          localForwardPort: 8788
        })
      })
    );
    expect(await screen.findByText("/root/code/project")).toBeInTheDocument();
  });

  it("checks an existing remote host", async () => {
    const diagnostics: RemoteHostDiagnostics = {
      host: remoteHost,
      checks: [
        {
          name: "github_proxy",
          status: "passed",
          message: "GitHub API is reachable through the forwarded local proxy.",
          output: "HTTP/2 200"
        }
      ],
      recommendedEnvironment: {
        HTTPS_PROXY: "http://127.0.0.1:1080"
      },
      checkedAt: "2026-04-25T00:00:00.000Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ repositories: [], tasks: [], remoteHosts: [remoteHost] }))
      .mockResolvedValueOnce(jsonResponse(diagnostics));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Check remote-dev" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/remote-hosts/remote-1/check", { method: "POST" });
    expect(await screen.findByText("github_proxy")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
  });
});
