import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { RemoteHostDiagnostics, RemoteProxyMode } from "../shared/types.js";
import {
  checkRemoteHost,
  createRemoteHost,
  createRepository,
  createTask,
  type DashboardData,
  fetchDashboard,
  runOrchestratorOnce
} from "./api.js";

const emptyDashboard: DashboardData = {
  repositories: [],
  tasks: [],
  taskEventsByTaskId: {},
  dispatcher: {
    enabled: false,
    running: false,
    intervalMs: 5000,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunHadTask: null,
    lastError: null
  },
  remoteHosts: []
};

export function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [projectName, setProjectName] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryRootPath, setRepositoryRootPath] = useState("");
  const [repositoryRemoteUrl, setRepositoryRemoteUrl] = useState("");
  const [repositoryMainBranch, setRepositoryMainBranch] = useState("main");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [workRoot, setWorkRoot] = useState("");
  const [proxyMode, setProxyMode] = useState<RemoteProxyMode>("auto");
  const [proxyUrl, setProxyUrl] = useState("");
  const [localForwardPort, setLocalForwardPort] = useState("");
  const [checkingHostId, setCheckingHostId] = useState<string | null>(null);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [hostChecksById, setHostChecksById] = useState<Record<string, RemoteHostDiagnostics>>({});
  const [error, setError] = useState<string | null>(null);

  const activeRepository = useMemo(() => dashboard.repositories[0], [dashboard.repositories]);
  const dispatcherState = dashboard.dispatcher.running ? "running" : dashboard.dispatcher.enabled ? "idle" : "disabled";
  const hasQueuedTask = useMemo(() => dashboard.tasks.some((task) => task.state === "queued"), [dashboard.tasks]);

  async function refresh() {
    const nextDashboard = await fetchDashboard();
    setDashboard(nextDashboard);
    setError(null);
  }

  useEffect(() => {
    let isMounted = true;

    fetchDashboard()
      .then((nextDashboard) => {
        if (isMounted) {
          setDashboard(nextDashboard);
          setError(null);
        }
      })
      .catch((refreshError: unknown) => {
        if (isMounted) {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to fetch dashboard data.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchDashboard()
        .then((nextDashboard) => {
          setDashboard(nextDashboard);
        })
        .catch(() => {
          // The foreground run will surface the actionable error.
        });
    }, 2000);

    return () => window.clearInterval(timer);
  }, []);

  async function submitRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedProjectName = projectName.trim();
    const trimmedRepositoryName = repositoryName.trim();
    const trimmedRootPath = repositoryRootPath.trim();
    const trimmedRemoteUrl = repositoryRemoteUrl.trim();
    const trimmedMainBranch = repositoryMainBranch.trim();

    if (
      trimmedProjectName === "" ||
      trimmedRepositoryName === "" ||
      trimmedRootPath === "" ||
      trimmedMainBranch === ""
    ) {
      setError("Project name, repository name, root path, and main branch are required.");
      return;
    }

    try {
      await createRepository({
        projectName: trimmedProjectName,
        name: trimmedRepositoryName,
        rootPath: trimmedRootPath,
        remoteUrl: trimmedRemoteUrl === "" ? null : trimmedRemoteUrl,
        mainBranch: trimmedMainBranch
      });
      setProjectName("");
      setRepositoryName("");
      setRepositoryRootPath("");
      setRepositoryRemoteUrl("");
      setRepositoryMainBranch("main");
      await refresh();
    } catch (repositoryError) {
      setError(repositoryError instanceof Error ? repositoryError.message : "Failed to register repository.");
    }
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeRepository) {
      setError("Register a repository before creating tasks.");
      return;
    }

    try {
      await createTask(activeRepository.id, title, goal);
      setTitle("");
      setGoal("");
      await refresh();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Failed to queue task.");
    }
  }

  async function runNextTask() {
    setOrchestratorRunning(true);

    try {
      const result = await runOrchestratorOnce();
      await refresh();

      if (!result.ran) {
        setError("No queued task is ready to run.");
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run orchestrator.");
    } finally {
      setOrchestratorRunning(false);
    }
  }

  async function submitRemoteHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = remoteName.trim();
    const trimmedSshHost = sshHost.trim();
    const trimmedWorkRoot = workRoot.trim();
    const trimmedProxyUrl = proxyUrl.trim();
    const trimmedForwardPort = localForwardPort.trim();
    const parsedForwardPort = trimmedForwardPort === "" ? null : Number(trimmedForwardPort);
    const normalizedProxyUrl =
      proxyMode === "direct" ? null : trimmedProxyUrl === "" ? "http://127.0.0.1:1080" : trimmedProxyUrl;

    if (trimmedName === "" || trimmedSshHost === "" || trimmedWorkRoot === "") {
      setError("Remote node name, SSH host, and work root are required.");
      return;
    }

    if (
      parsedForwardPort !== null &&
      (!Number.isInteger(parsedForwardPort) || parsedForwardPort <= 0 || parsedForwardPort > 65535)
    ) {
      setError("Local forward port must be a valid TCP port.");
      return;
    }

    try {
      await createRemoteHost({
        name: trimmedName,
        sshHost: trimmedSshHost,
        workRoot: trimmedWorkRoot,
        proxyMode,
        proxyUrl: normalizedProxyUrl,
        localForwardPort: parsedForwardPort
      });
      setRemoteName("");
      setSshHost("");
      setWorkRoot("");
      setProxyMode("auto");
      setProxyUrl("");
      setLocalForwardPort("");
      await refresh();
    } catch (remoteHostError) {
      setError(remoteHostError instanceof Error ? remoteHostError.message : "Failed to register remote host.");
    }
  }

  async function runRemoteHostCheck(hostId: string) {
    setCheckingHostId(hostId);

    try {
      const diagnostics = await checkRemoteHost(hostId);
      setHostChecksById((current) => ({
        ...current,
        [hostId]: diagnostics
      }));
      setError(null);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Failed to check remote host.");
    } finally {
      setCheckingHostId(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local Orchestrator</p>
          <h1>agent-fleet</h1>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {error ? (
        <section className="error-banner" role="alert">
          {error}
        </section>
      ) : null}

      <section className="dashboard-grid" aria-label="Fleet dashboard">
        <section className="panel projects-panel">
          <div className="panel-heading">
            <p className="eyebrow">Workspace</p>
            <h2>Projects</h2>
          </div>

          <form className="repository-form" onSubmit={(event) => void submitRepository(event)}>
            <input
              aria-label="Project name"
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              type="text"
              value={projectName}
            />
            <input
              aria-label="Repository name"
              onChange={(event) => setRepositoryName(event.target.value)}
              placeholder="Repository name"
              type="text"
              value={repositoryName}
            />
            <input
              aria-label="Repository root path"
              onChange={(event) => setRepositoryRootPath(event.target.value)}
              placeholder="/absolute/path/to/repo"
              type="text"
              value={repositoryRootPath}
            />
            <input
              aria-label="Remote URL"
              onChange={(event) => setRepositoryRemoteUrl(event.target.value)}
              placeholder="https://github.com/org/repo.git"
              type="text"
              value={repositoryRemoteUrl}
            />
            <input
              aria-label="Main branch"
              onChange={(event) => setRepositoryMainBranch(event.target.value)}
              placeholder="main"
              type="text"
              value={repositoryMainBranch}
            />
            <button type="submit">Add repository</button>
          </form>

          {dashboard.repositories.length === 0 ? (
            <p className="empty-copy">No repositories registered.</p>
          ) : (
            <div className="repository-list">
              {dashboard.repositories.map((repository) => (
                <article className="repository-row" key={repository.id}>
                  <h3>{repository.name}</h3>
                  <p>{repository.rootPath}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel task-panel">
          <div className="panel-heading panel-heading-with-action">
            <div className="task-heading-copy">
              <div>
                <p className="eyebrow">Dispatch</p>
                <h2>Task Queue</h2>
              </div>
              <div className="dispatcher-summary">
                <span className="dispatcher-label">Auto dispatcher</span>
                <span className={`dispatcher-state dispatcher-${dispatcherState}`}>{dispatcherState}</span>
                {dashboard.dispatcher.lastError ? (
                  <span className="dispatcher-error">{dashboard.dispatcher.lastError}</span>
                ) : null}
              </div>
            </div>
            <button
              className="secondary-button compact-button"
              disabled={orchestratorRunning || dashboard.dispatcher.running || !hasQueuedTask}
              onClick={() => void runNextTask()}
              type="button"
            >
              {orchestratorRunning ? "Running" : "Run once"}
            </button>
          </div>

          <form className="task-form" onSubmit={(event) => void submitTask(event)}>
            <input
              aria-label="Task title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              type="text"
              value={title}
            />
            <textarea
              aria-label="Goal and acceptance criteria"
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Goal and acceptance criteria"
              value={goal}
            />
            <button type="submit">Queue task</button>
          </form>

          {dashboard.tasks.length === 0 ? (
            <p className="empty-copy">No queued tasks.</p>
          ) : (
            <div className="task-list">
              {dashboard.tasks.map((task) => {
                const events = dashboard.taskEventsByTaskId?.[task.id] ?? [];

                return (
                  <article className="task-row" key={task.id}>
                    <div>
                      <h3>{task.title}</h3>
                      <p>{task.goal}</p>
                    </div>
                    <span className={`task-state state-${task.state}`}>{task.state}</span>

                    {events.length > 0 ? (
                      <ol aria-label={`Progress for ${task.title}`} className="task-event-list">
                        {events.map((event) => (
                          <li className="task-event-row" key={event.id}>
                            <span className="task-event-actor">{event.actor}</span>
                            <span className="task-event-message">{event.message}</span>
                            <span className={`task-state state-${event.state}`}>{event.state}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel remote-host-panel">
          <div className="panel-heading">
            <p className="eyebrow">Execution</p>
            <h2>Remote Nodes</h2>
          </div>

          <form className="remote-host-form" onSubmit={(event) => void submitRemoteHost(event)}>
            <input
              aria-label="Node name"
              onChange={(event) => setRemoteName(event.target.value)}
              placeholder="Node name"
              type="text"
              value={remoteName}
            />
            <input
              aria-label="SSH host"
              onChange={(event) => setSshHost(event.target.value)}
              placeholder="SSH host"
              type="text"
              value={sshHost}
            />
            <input
              aria-label="Work root"
              onChange={(event) => setWorkRoot(event.target.value)}
              placeholder="Work root"
              type="text"
              value={workRoot}
            />
            <select
              aria-label="Proxy mode"
              onChange={(event) => setProxyMode(event.target.value as RemoteProxyMode)}
              value={proxyMode}
            >
              <option value="auto">Auto proxy fallback</option>
              <option value="direct">Direct only</option>
              <option value="http_proxy">HTTP proxy</option>
            </select>
            <input
              aria-label="Proxy URL"
              onChange={(event) => setProxyUrl(event.target.value)}
              placeholder="http://127.0.0.1:1080"
              type="text"
              value={proxyUrl}
            />
            <input
              aria-label="Local forward port"
              inputMode="numeric"
              onChange={(event) => setLocalForwardPort(event.target.value)}
              placeholder="8788"
              type="text"
              value={localForwardPort}
            />
            <button type="submit">Add remote node</button>
          </form>

          {dashboard.remoteHosts.length === 0 ? (
            <p className="empty-copy">No remote execution nodes registered.</p>
          ) : (
            <div className="remote-host-list">
              {dashboard.remoteHosts.map((host) => {
                const diagnostics = hostChecksById[host.id];

                return (
                  <article className="remote-host-row" key={host.id}>
                    <div className="remote-host-main">
                      <div>
                        <h3>{host.name}</h3>
                        <p className="remote-host-meta">{host.sshHost}</p>
                        <p className="remote-host-meta">{host.workRoot}</p>
                        <p className="remote-host-meta">
                          {host.proxyMode}
                          {host.proxyUrl ? ` / ${host.proxyUrl}` : ""}
                        </p>
                      </div>
                      <button
                        aria-label={`Check ${host.name}`}
                        className="secondary-button compact-button"
                        disabled={checkingHostId === host.id}
                        onClick={() => void runRemoteHostCheck(host.id)}
                        type="button"
                      >
                        {checkingHostId === host.id ? "Checking" : "Check"}
                      </button>
                    </div>

                    {diagnostics ? (
                      <div className="remote-check-list">
                        {diagnostics.checks.map((check) => (
                          <div className="remote-check-row" key={check.name}>
                            <span>{check.name}</span>
                            <span className={`check-status check-${check.status}`}>{check.status}</span>
                            <p>{check.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
