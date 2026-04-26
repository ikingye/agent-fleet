import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { DashboardData, StewardDecision } from "../shared/types.js";
import { correctDecision, createGoal, fetchDashboard } from "./api.js";

const emptyDashboard: DashboardData = {
  goals: [],
  decisions: [],
  workerSessions: [],
  corrections: [],
  memories: [],
  executionNodes: [],
  worktreeAssignments: [],
  events: []
};

function actions(decision: StewardDecision): string[] {
  try {
    return JSON.parse(decision.actionsJson) as string[];
  } catch {
    return [];
  }
}

export function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [projectName, setProjectName] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalBody, setGoalBody] = useState("");
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const activeDecisions = useMemo(
    () => dashboard.decisions.filter((decision) => decision.status === "active" || decision.needsHumanReview),
    [dashboard.decisions]
  );
  const humanReviewCount = useMemo(
    () => dashboard.decisions.filter((decision) => decision.needsHumanReview).length,
    [dashboard.decisions]
  );
  const runningWorkerCount = useMemo(
    () => dashboard.workerSessions.filter((session) => session.status === "running").length,
    [dashboard.workerSessions]
  );
  const memoryCount = dashboard.memories.length;

  async function refresh() {
    const nextDashboard = await fetchDashboard();
    setDashboard(nextDashboard);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;

    fetchDashboard()
      .then((nextDashboard) => {
        if (mounted) {
          setDashboard(nextDashboard);
        }
      })
      .catch((fetchError: unknown) => {
        if (mounted) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to fetch dashboard.");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await createGoal({
        projectName: projectName.trim(),
        title: goalTitle.trim(),
        body: goalBody.trim()
      });
      setProjectName("");
      setGoalTitle("");
      setGoalBody("");
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to start Steward.");
    }
  }

  async function submitCorrection(decisionId: string) {
    const body = correctionDrafts[decisionId]?.trim() ?? "";

    if (body === "") {
      setError("Correction cannot be empty.");
      return;
    }

    try {
      await correctDecision(decisionId, body);
      setCorrectionDrafts((current) => ({ ...current, [decisionId]: "" }));
      await refresh();
    } catch (correctionError) {
      setError(correctionError instanceof Error ? correctionError.message : "Failed to send correction.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Steward Control Plane</p>
          <h1>agent-fleet</h1>
        </div>
        <button className="secondary-button" onClick={() => void refresh()} type="button">
          Refresh
        </button>
      </header>

      {error ? (
        <section className="error-banner" role="alert">
          {error}
        </section>
      ) : null}

      <section className="metric-grid" aria-label="supervision metrics">
        <article className="metric-tile">
          <span>{humanReviewCount}</span>
          <p>Human Review</p>
        </article>
        <article className="metric-tile">
          <span>{runningWorkerCount}</span>
          <p>Running Workers</p>
        </article>
        <article className="metric-tile">
          <span>{memoryCount}</span>
          <p>Memory Items</p>
        </article>
      </section>

      <section className="dashboard-grid" aria-label="agent-fleet dashboard">
        <section className="panel goal-panel">
          <div className="panel-heading">
            <p className="eyebrow">Human Intent</p>
            <h2>Steward Intake</h2>
          </div>
          <form className="stack-form" onSubmit={(event) => void submitGoal(event)}>
            <input
              aria-label="Project"
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project"
              type="text"
              value={projectName}
            />
            <input
              aria-label="Goal title"
              onChange={(event) => setGoalTitle(event.target.value)}
              placeholder="Goal title"
              type="text"
              value={goalTitle}
            />
            <textarea
              aria-label="Goal body"
              onChange={(event) => setGoalBody(event.target.value)}
              placeholder="Goal, constraints, acceptance criteria"
              value={goalBody}
            />
            <button type="submit">Start Steward</button>
          </form>
          <div className="item-list">
            {dashboard.goals.length === 0 ? (
              <p className="empty-copy">No goals accepted yet.</p>
            ) : (
              dashboard.goals.map((goal) => (
                <article className="item-row" key={goal.id}>
                  <div>
                    <h3>{goal.title}</h3>
                    <p>{goal.body}</p>
                  </div>
                  <span className={`pill status-${goal.status}`}>{goal.status}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel decision-panel">
          <div className="panel-heading">
            <p className="eyebrow">Autonomy Audit</p>
            <h2>Decision Ledger</h2>
          </div>
          <div className="item-list">
            {activeDecisions.length === 0 ? (
              <p className="empty-copy">No Steward decisions recorded.</p>
            ) : (
              activeDecisions.map((decision) => (
                <article className="decision-row" key={decision.id}>
                  <div className="decision-head">
                    <div>
                      <h3>{decision.title}</h3>
                      <p>{decision.rationale}</p>
                    </div>
                    <div className="badge-cluster">
                      <span className={`pill risk-${decision.risk}`}>{decision.risk}</span>
                      {decision.needsHumanReview ? <span className="pill review-pill">needs review</span> : null}
                    </div>
                  </div>
                  <dl className="decision-metrics">
                    <div>
                      <dt>confidence</dt>
                      <dd>{Math.round(decision.confidence * 100)}%</dd>
                    </div>
                    <div>
                      <dt>reversible</dt>
                      <dd>{decision.reversible ? "yes" : "no"}</dd>
                    </div>
                    <div>
                      <dt>status</dt>
                      <dd>{decision.status}</dd>
                    </div>
                  </dl>
                  <ul className="action-list">
                    {actions(decision).map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                  <div className="correction-box">
                    <textarea
                      aria-label={`Correction for ${decision.title}`}
                      onChange={(event) =>
                        setCorrectionDrafts((current) => ({ ...current, [decision.id]: event.target.value }))
                      }
                      placeholder="Correct this Steward decision"
                      value={correctionDrafts[decision.id] ?? ""}
                    />
                    <button onClick={() => void submitCorrection(decision.id)} type="button">
                      Send correction
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel worker-panel">
          <div className="panel-heading">
            <p className="eyebrow">Execution</p>
            <h2>Worker Sessions</h2>
          </div>
          <div className="item-list">
            {dashboard.workerSessions.length === 0 ? (
              <p className="empty-copy">No Worker Agent sessions yet.</p>
            ) : (
              dashboard.workerSessions.map((session) => (
                <article className="item-row worker-row" key={session.id}>
                  <div>
                    <h3>{session.kind}</h3>
                    <p>{session.command}</p>
                    <p>{session.cwd}</p>
                    {session.pid ? <p>pid {session.pid}</p> : null}
                    {session.resumeId ? <p>{session.resumeId}</p> : null}
                    {session.status === "failed" && session.lastOutput ? <p>{session.lastOutput}</p> : null}
                  </div>
                  <span className={`pill status-${session.status}`}>{session.status}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel memory-panel">
          <div className="panel-heading">
            <p className="eyebrow">Learning</p>
            <h2>Memory</h2>
          </div>
          <div className="item-list">
            {dashboard.memories.length === 0 ? (
              <p className="empty-copy">No learned preferences yet.</p>
            ) : (
              dashboard.memories.map((memory) => (
                <article className="item-row" key={memory.id}>
                  <div>
                    <h3>{memory.key}</h3>
                    <p>{memory.value}</p>
                  </div>
                  <span className="pill">{memory.scope}</span>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
