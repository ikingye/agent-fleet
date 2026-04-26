import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { ExecutionNode, StewardDecision, WorkerSession } from "../shared/types.js";
import {
  type ClientDashboardData,
  correctDecision,
  createGoal,
  fetchDashboard,
  registerExecutionNode,
  sendStewardMessage
} from "./api.js";

const emptyDashboard: ClientDashboardData = {
  goals: [],
  decisions: [],
  workerSessions: [],
  corrections: [],
  memories: [],
  executionNodes: [],
  worktreeAssignments: [],
  stewardCheckpoints: [],
  agentArtifacts: [],
  reviews: [],
  deliveryReports: [],
  stewardMessages: [],
  events: []
};

const ownerHomePath = "/Users/yewang";

function displayPath(path: string): string {
  if (path === ownerHomePath) {
    return "~";
  }

  if (path.startsWith(`${ownerHomePath}/`)) {
    return `~/${path.slice(ownerHomePath.length + 1)}`;
  }

  return path;
}

function actions(decision: StewardDecision): string[] {
  try {
    return JSON.parse(decision.actionsJson) as string[];
  } catch {
    return [];
  }
}

function resumeCommand(command: string, resumeId: string): string {
  return `${command} resume ${resumeId}`;
}

function formatEventTime(timestamp: string): string {
  return timestamp.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").replace(/Z$/, " UTC");
}

function isVisibleWorkerSession(session: WorkerSession): boolean {
  return session.status === "starting" || session.status === "running" || session.status === "paused";
}

export function App() {
  const [dashboard, setDashboard] = useState<ClientDashboardData>(emptyDashboard);
  const [projectName, setProjectName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalBody, setGoalBody] = useState("");
  const [stewardMessageBody, setStewardMessageBody] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [nodeSshHost, setNodeSshHost] = useState("");
  const [nodeWorkRoot, setNodeWorkRoot] = useState("");
  const [nodeProxyUrl, setNodeProxyUrl] = useState("");
  const [nodeTags, setNodeTags] = useState("");
  const [nodeCapacity, setNodeCapacity] = useState("1");
  const [nodeStatus, setNodeStatus] = useState<ExecutionNode["status"]>("unknown");
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
  const remoteNodes = useMemo(() => dashboard.executionNodes.filter((node) => node.kind === "remote"), [dashboard.executionNodes]);
  const recentEvents = useMemo(() => [...dashboard.events].slice(-8).reverse(), [dashboard.events]);
  const visibleWorkerSessions = useMemo(
    () => dashboard.workerSessions.filter((session) => isVisibleWorkerSession(session)),
    [dashboard.workerSessions]
  );
  const historicalWorkerSessions = useMemo(
    () =>
      dashboard.workerSessions
        .filter((session) => !isVisibleWorkerSession(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [dashboard.workerSessions]
  );
  const memoryCount = dashboard.memories.length;
  const goalCount = dashboard.goals.length;
  const workerCount = dashboard.workerSessions.length;

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
        workspacePath: workspacePath.trim(),
        title: goalTitle.trim(),
        body: goalBody.trim()
      });
      setProjectName(projectName.trim());
      setWorkspacePath(workspacePath.trim());
      setGoalTitle("");
      setGoalBody("");
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to start Steward.");
    }
  }

  async function submitStewardMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = stewardMessageBody.trim();

    if (body === "") {
      setError("Steward message cannot be empty.");
      return;
    }

    try {
      await sendStewardMessage({
        body,
        ...(projectName.trim() === "" ? {} : { projectName: projectName.trim() }),
        ...(workspacePath.trim() === "" ? {} : { workspacePath: workspacePath.trim() })
      });
      setStewardMessageBody("");
      await refresh();
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "Failed to send Steward message.");
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

  async function submitRemoteNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await registerExecutionNode({
        name: nodeName.trim(),
        kind: "remote",
        status: nodeStatus,
        sshHost: nodeSshHost.trim() === "" ? null : nodeSshHost.trim(),
        workRoot: nodeWorkRoot.trim(),
        proxyUrl: nodeProxyUrl.trim() === "" ? null : nodeProxyUrl.trim(),
        tags: nodeTags
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag !== ""),
        capacity: Number.parseInt(nodeCapacity, 10)
      });
      setNodeName("");
      setNodeSshHost("");
      setNodeWorkRoot("");
      setNodeProxyUrl("");
      setNodeTags("");
      setNodeCapacity("1");
      setNodeStatus("unknown");
      await refresh();
    } catch (nodeError) {
      setError(nodeError instanceof Error ? nodeError.message : "Failed to register execution node.");
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
        <article className="metric-tile">
          <span>{goalCount}</span>
          <p>Goals</p>
        </article>
        <article className="metric-tile">
          <span>{workerCount}</span>
          <p>Worker Sessions</p>
        </article>
      </section>

      <section className="dashboard-grid" aria-label="agent-fleet dashboard">
        <section className="panel intake-panel">
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
              aria-label="Target directory"
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder="~/code/project/target"
              required
              type="text"
              value={workspacePath}
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
        </section>

        <section className="panel chat-panel">
          <div className="panel-heading">
            <p className="eyebrow">Durable Conversation</p>
            <h2>Steward Chat</h2>
          </div>
          <div className="chat-log" aria-label="Steward messages">
            {dashboard.stewardMessages.length === 0 ? (
              <p className="empty-copy">No Steward conversation recorded.</p>
            ) : (
              dashboard.stewardMessages.map((message) => (
                <article className={`message-row message-${message.role}`} key={message.id}>
                  <div className="message-meta">
                    <span>{message.role}</span>
                    {message.projectName ? <span>{message.projectName}</span> : null}
                    {message.workspacePath ? <code>{displayPath(message.workspacePath)}</code> : null}
                    <time dateTime={message.createdAt}>{formatEventTime(message.createdAt)}</time>
                  </div>
                  <p>{message.body}</p>
                </article>
              ))
            )}
          </div>
          <form className="stack-form chat-form" onSubmit={(event) => void submitStewardMessage(event)}>
            <textarea
              aria-label="Message Steward"
              onChange={(event) => setStewardMessageBody(event.target.value)}
              placeholder="Message the Steward Agent"
              value={stewardMessageBody}
            />
            <button type="submit">Send to Steward</button>
          </form>
        </section>

        <section className="panel goals-panel">
          <div className="panel-heading compact-heading">
            <p className="eyebrow">Targets</p>
            <h2>Goals</h2>
          </div>
          <div className="item-list scroll-list compact-list">
            {dashboard.goals.length === 0 ? (
              <p className="empty-copy">No goals accepted yet.</p>
            ) : (
              dashboard.goals.map((goal) => (
                <article className="item-row compact-row" key={goal.id}>
                  <div>
                    <h3>{goal.title}</h3>
                    {goal.workspacePath ? (
                      <dl className="resource-facts compact-facts">
                        <div>
                          <dt>target</dt>
                          <dd>{displayPath(goal.workspacePath)}</dd>
                        </div>
                      </dl>
                    ) : null}
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
            <h2>Decisions Needing Review</h2>
          </div>
          <div className="item-list scroll-list decision-list">
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
                  <dl className="decision-metrics inline-facts">
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
                  {actions(decision).length > 0 ? (
                    <p className="action-summary">{actions(decision).join(" | ")}</p>
                  ) : null}
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

        <section aria-labelledby="worker-sessions-heading" className="panel worker-panel">
          <div className="panel-heading">
            <p className="eyebrow">Execution</p>
            <h2 id="worker-sessions-heading">Worker Sessions</h2>
          </div>
          <div className="item-list scroll-list compact-list">
            {dashboard.workerSessions.length === 0 ? (
              <p className="empty-copy">No Worker Agent sessions yet.</p>
            ) : (
              <>
                {visibleWorkerSessions.length === 0 ? <p className="empty-copy">No active Worker Agent sessions.</p> : null}
                {visibleWorkerSessions.map((session) => (
                  <article className="item-row worker-row compact-row" key={session.id}>
                    <div>
                      <h3>
                        {session.kind} <span>{session.command}</span>
                      </h3>
                      <p>{displayPath(session.cwd)}</p>
                      <div className="row-meta">
                        {session.pid ? <span>pid {session.pid}</span> : null}
                        {session.resumeId ? <span>resume {session.resumeId}</span> : null}
                      </div>
                      {session.resumeId ? <code className="copy-command">{resumeCommand(session.command, session.resumeId)}</code> : null}
                    </div>
                    <span className={`pill status-${session.status}`}>{session.status}</span>
                  </article>
                ))}
                {historicalWorkerSessions.length > 0 ? (
                  <details aria-label="Historical Worker sessions" className="worker-history">
                    <summary>
                      <span>History</span>
                      <strong>{historicalWorkerSessions.length} historical sessions</strong>
                    </summary>
                    <div className="worker-history-list">
                      {historicalWorkerSessions.map((session) => (
                        <article className="worker-history-row" key={session.id}>
                          <div className="worker-history-main">
                            <h3>{session.kind}</h3>
                            <p>{displayPath(session.cwd)}</p>
                            {session.lastOutput ? <pre>{session.lastOutput}</pre> : null}
                          </div>
                          <div className="worker-history-meta">
                            <span className={`pill status-${session.status}`}>{session.status}</span>
                            {session.resumeId ? <span>resume {session.resumeId}</span> : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="panel recovery-panel">
          <div className="panel-heading">
            <p className="eyebrow">Recovery Context</p>
            <h2>Recovery / Audit</h2>
          </div>
          <div className="recovery-grid">
            <section className="subpanel">
              <div className="subpanel-heading">
                <h2>Worktrees</h2>
              </div>
              <div className="item-list scroll-list mini-list">
                {dashboard.worktreeAssignments.length === 0 ? (
                  <p className="empty-copy">No worktree assignments yet.</p>
                ) : (
                  dashboard.worktreeAssignments.map((assignment) => (
                    <article className="item-row resource-row compact-row" key={assignment.id}>
                      <div>
                        <h3>{assignment.branchName}</h3>
                        <dl className="resource-facts">
                          <div>
                            <dt>path</dt>
                            <dd>{displayPath(assignment.worktreePath)}</dd>
                          </div>
                          <div>
                            <dt>repo</dt>
                            <dd>{displayPath(assignment.repositoryPath)}</dd>
                          </div>
                        </dl>
                      </div>
                      <span className={`pill status-${assignment.status}`}>{assignment.status}</span>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="subpanel">
              <div className="subpanel-heading">
                <h2>Events / Audit</h2>
              </div>
              <div className="item-list scroll-list mini-list">
                {recentEvents.length === 0 ? (
                  <p className="empty-copy">No control-plane events recorded.</p>
                ) : (
                  recentEvents.map((event) => (
                    <article className="event-row compact-event-row" key={event.id}>
                      <div className="event-head">
                        <h3>{event.type}</h3>
                        <time dateTime={event.createdAt}>{formatEventTime(event.createdAt)}</time>
                      </div>
                      <p>{event.message}</p>
                      <dl className="event-links">
                        {event.goalId ? (
                          <div>
                            <dt>goal</dt>
                            <dd>{event.goalId}</dd>
                          </div>
                        ) : null}
                        {event.decisionId ? (
                          <div>
                            <dt>decision</dt>
                            <dd>{event.decisionId}</dd>
                          </div>
                        ) : null}
                        {event.workerSessionId ? (
                          <div>
                            <dt>worker</dt>
                            <dd>{event.workerSessionId}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>

        <details className="panel node-panel secondary-panel" open>
          <summary>
            <span className="eyebrow">Remote Capacity</span>
            <h2>Remote Nodes</h2>
          </summary>
          <form className="node-form" onSubmit={(event) => void submitRemoteNode(event)}>
            <input
              aria-label="Remote node name"
              onChange={(event) => setNodeName(event.target.value)}
              placeholder="name"
              required
              type="text"
              value={nodeName}
            />
            <input
              aria-label="SSH host"
              onChange={(event) => setNodeSshHost(event.target.value)}
              placeholder="ssh user@host"
              type="text"
              value={nodeSshHost}
            />
            <input
              aria-label="Work root"
              onChange={(event) => setNodeWorkRoot(event.target.value)}
              placeholder="/work/root"
              required
              type="text"
              value={nodeWorkRoot}
            />
            <input
              aria-label="Proxy URL"
              onChange={(event) => setNodeProxyUrl(event.target.value)}
              placeholder="proxy URL"
              type="url"
              value={nodeProxyUrl}
            />
            <input
              aria-label="Tags"
              onChange={(event) => setNodeTags(event.target.value)}
              placeholder="remote, linux, high-cpu"
              type="text"
              value={nodeTags}
            />
            <input
              aria-label="Capacity"
              min="1"
              onChange={(event) => setNodeCapacity(event.target.value)}
              placeholder="capacity"
              required
              type="number"
              value={nodeCapacity}
            />
            <select
              aria-label="Remote node status"
              onChange={(event) => setNodeStatus(event.target.value as ExecutionNode["status"])}
              value={nodeStatus}
            >
              <option value="unknown">unknown</option>
              <option value="ready">ready</option>
              <option value="offline">offline</option>
            </select>
            <button type="submit">Register node</button>
          </form>
          <div className="item-list scroll-list mini-list">
            {remoteNodes.length === 0 ? (
              <p className="empty-copy">No remote execution nodes registered.</p>
            ) : (
              remoteNodes.map((node) => (
                <article className="item-row resource-row compact-row" key={node.id}>
                  <div>
                    <h3>{node.name}</h3>
                    <dl className="resource-facts">
                      {node.sshHost ? (
                        <div>
                          <dt>ssh</dt>
                          <dd>{node.sshHost}</dd>
                        </div>
                      ) : null}
                      {node.proxyUrl ? (
                        <div>
                          <dt>proxy</dt>
                          <dd>{node.proxyUrl}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>root</dt>
                        <dd>{displayPath(node.workRoot)}</dd>
                      </div>
                      <div>
                        <dt>tags</dt>
                        <dd>{node.tags.length === 0 ? "none" : node.tags.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>capacity</dt>
                        <dd>{node.capacity}</dd>
                      </div>
                    </dl>
                  </div>
                  <span className={`pill status-${node.status}`}>{node.status}</span>
                </article>
              ))
            )}
          </div>
        </details>

        <details className="panel memory-panel secondary-panel">
          <summary>
            <span className="eyebrow">Learning</span>
            <h2>Memory</h2>
          </summary>
          <div className="item-list scroll-list mini-list">
            {dashboard.memories.length === 0 ? (
              <p className="empty-copy">No learned preferences yet.</p>
            ) : (
              dashboard.memories.map((memory) => (
                <article className="item-row compact-row" key={memory.id}>
                  <div>
                    <h3>{memory.key}</h3>
                    <p>{memory.value}</p>
                  </div>
                  <span className="pill">{memory.scope}</span>
                </article>
              ))
            )}
          </div>
        </details>
      </section>
    </main>
  );
}
