export function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local Orchestrator</p>
          <h1>agent-fleet</h1>
        </div>
        <span className="status-pill">MVP</span>
      </header>
      <section className="empty-state">
        <h2>Fleet dashboard</h2>
        <p>Task queue, agent runs, worktrees, checks, review, merge, and push status will appear here.</p>
      </section>
    </main>
  );
}
