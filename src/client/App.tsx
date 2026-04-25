import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createTask, type DashboardData, fetchDashboard } from "./api.js";

const emptyDashboard: DashboardData = {
  repositories: [],
  tasks: []
};

export function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeRepository = useMemo(() => dashboard.repositories[0], [dashboard.repositories]);

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
          <div className="panel-heading">
            <p className="eyebrow">Dispatch</p>
            <h2>Task Queue</h2>
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
              {dashboard.tasks.map((task) => (
                <article className="task-row" key={task.id}>
                  <div>
                    <h3>{task.title}</h3>
                    <p>{task.goal}</p>
                  </div>
                  <span className={`task-state state-${task.state}`}>{task.state}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel active-run-panel">
          <div className="panel-heading">
            <p className="eyebrow">Execution</p>
            <h2>Active Run</h2>
          </div>
          <p className="plan-copy">
            Plan, worktree, agent logs, checks, review, merge, and push status will appear here as
            queued tasks move through the local orchestrator.
          </p>
        </section>
      </section>
    </main>
  );
}
