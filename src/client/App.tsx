import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { ExecutionNode, StewardDecision, WorkerReport, WorkerSession } from "../shared/types.js";
import {
  type ClientDashboardData,
  type ClientExecutionNode,
  correctDecision,
  createGoal,
  fetchDashboard,
  reconcileRecovery,
  registerExecutionNode,
  runAutonomyTick,
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
  workerReports: [],
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

function formatCapacity(capacity: number): string {
  return `${capacity} ${capacity === 1 ? "slot" : "slots"}`;
}

function executionNodeNote(node: ClientExecutionNode): string | null {
  const note = node.lastHighLevelNote ?? node.lastNote ?? node.note ?? null;
  return note === "" ? null : note;
}

function isVisibleWorkerSession(session: WorkerSession): boolean {
  return session.status === "starting" || session.status === "running" || session.status === "paused";
}

function isKeyDecision(decision: StewardDecision): boolean {
  return (
    decision.needsHumanReview ||
    decision.risk === "high" ||
    decision.status === "corrected" ||
    (decision.status === "active" && decision.risk !== "low")
  );
}

function primaryReportDetail(values: string[]): string {
  return values[0] ?? "No detail recorded.";
}

function reportFileSummary(report: WorkerReport): string {
  if (report.changedFiles.length === 0) {
    return "No files listed.";
  }

  return report.changedFiles.slice(0, 3).join(", ");
}

type DashboardTab = "overview" | "goals" | "workers" | "recovery" | "resources";

const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "goals", label: "Goals" },
  { id: "workers", label: "Workers" },
  { id: "recovery", label: "Recovery" },
  { id: "resources", label: "Resources" }
];

export function App() {
  const [dashboard, setDashboard] = useState<ClientDashboardData>(emptyDashboard);
  const [selectedTab, setSelectedTab] = useState<DashboardTab>("overview");
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
  const [showWorkerMessages, setShowWorkerMessages] = useState(false);
  const [showWorkerDebug, setShowWorkerDebug] = useState(false);
  const [showWorkerHistory, setShowWorkerHistory] = useState(false);
  const [ownerActionRunning, setOwnerActionRunning] = useState<"autonomy" | "reconcile" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyDecisions = useMemo(
    () =>
      dashboard.decisions
        .filter((decision) => isKeyDecision(decision))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
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
  const workerSessionById = useMemo(
    () => new Map(dashboard.workerSessions.map((session) => [session.id, session])),
    [dashboard.workerSessions]
  );
  const goalById = useMemo(() => new Map(dashboard.goals.map((goal) => [goal.id, goal])), [dashboard.goals]);
  const decisionById = useMemo(
    () => new Map(dashboard.decisions.map((decision) => [decision.id, decision])),
    [dashboard.decisions]
  );
  const executionNodeById = useMemo(
    () => new Map(dashboard.executionNodes.map((node) => [node.id, node])),
    [dashboard.executionNodes]
  );
  const historicalWorkerSessions = useMemo(
    () =>
      dashboard.workerSessions
        .filter((session) => !isVisibleWorkerSession(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [dashboard.workerSessions]
  );
  const ownerFacingMessages = useMemo(
    () => dashboard.stewardMessages.filter((message) => message.role !== "worker"),
    [dashboard.stewardMessages]
  );
  const workerMessages = useMemo(
    () => dashboard.stewardMessages.filter((message) => message.role === "worker"),
    [dashboard.stewardMessages]
  );
  const recentWorkerReports = useMemo(
    () => [...dashboard.workerReports].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5),
    [dashboard.workerReports]
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

  async function runOwnerAction(kind: "autonomy" | "reconcile") {
    setOwnerActionRunning(kind);

    try {
      if (kind === "autonomy") {
        await runAutonomyTick();
      } else {
        await reconcileRecovery();
      }
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Owner action failed.");
    } finally {
      setOwnerActionRunning(null);
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

      <nav aria-label="Dashboard sections" className="dashboard-tabs" role="tablist">
        {dashboardTabs.map((tab) => (
          <button
            aria-controls={`${tab.id}-panel`}
            aria-selected={selectedTab === tab.id}
            className={selectedTab === tab.id ? "tab-button active-tab" : "tab-button"}
            id={`${tab.id}-tab`}
            key={tab.id}
            onClick={() => setSelectedTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby={`${selectedTab}-tab`}
        className="tab-panel"
        id={`${selectedTab}-panel`}
        role="tabpanel"
      >
      <section className="metric-grid" aria-label="supervision metrics" hidden={selectedTab !== "overview"}>
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

      <section className={`dashboard-grid tab-${selectedTab}`} aria-label="agent-fleet dashboard">
        <section className="panel intake-panel" hidden={selectedTab !== "overview"}>
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
              aria-describedby="target-directory-hint"
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder="~/code/project/target"
              required
              type="text"
              value={workspacePath}
            />
            <p className="field-hint" id="target-directory-hint">
              External workspace path required
            </p>
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

        <section className="panel chat-panel" hidden={selectedTab !== "overview"}>
          <div className="panel-heading">
            <p className="eyebrow">Durable Conversation</p>
            <h2>Steward Chat</h2>
          </div>
          <div className="chat-log" aria-label="Steward messages">
            {ownerFacingMessages.length === 0 ? (
              <p className="empty-copy">No Steward conversation recorded.</p>
            ) : (
              ownerFacingMessages.map((message) => (
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
            {workerMessages.length > 0 ? (
              <div className="worker-message-disclosure">
                <button
                  className="link-button"
                  onClick={() => setShowWorkerMessages((current) => !current)}
                  type="button"
                >
                  {workerMessages.length} Worker {workerMessages.length === 1 ? "message" : "messages"} hidden
                </button>
                {showWorkerMessages ? (
                  <div className="worker-message-audit" aria-label="Worker chat audit">
                    {workerMessages.map((message) => (
                      <article className={`message-row message-${message.role}`} key={message.id}>
                        <div className="message-meta">
                          <span>{message.role}</span>
                          {message.projectName ? <span>{message.projectName}</span> : null}
                          {message.workspacePath ? <code>{displayPath(message.workspacePath)}</code> : null}
                          <time dateTime={message.createdAt}>{formatEventTime(message.createdAt)}</time>
                        </div>
                        <p>{message.body}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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

        <section className="panel goals-panel" hidden={selectedTab !== "goals"}>
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

        <section className="panel decision-panel" hidden={selectedTab !== "overview"}>
          <div className="panel-heading">
            <p className="eyebrow">Owner Review</p>
            <h2>Key Decisions</h2>
          </div>
          <div className="item-list scroll-list decision-list">
            {keyDecisions.length === 0 ? (
              <p className="empty-copy">No Steward decisions recorded.</p>
            ) : (
              keyDecisions.map((decision) => {
                const workerSession =
                  decision.workerSessionId === null ? null : workerSessionById.get(decision.workerSessionId) ?? null;
                const executionNode =
                  workerSession?.hostId === null || workerSession?.hostId === undefined
                    ? null
                    : executionNodeById.get(workerSession.hostId) ?? null;
                const nodeNote = executionNode === null ? null : executionNodeNote(executionNode);

                return (
                  <article className="decision-row" key={decision.id}>
                    <div className="decision-head">
                      <div>
                        <h3>{decision.title}</h3>
                        <p>{decision.rationale}</p>
                      </div>
                      <div className="badge-cluster">
                        <span className={`pill risk-${decision.risk}`}>{decision.risk}</span>
                        {decision.needsHumanReview ? <span className="pill review-pill">needs review</span> : null}
                        {decision.needsHumanReview || decision.risk === "high" ? (
                          <span className="pill double-check-pill">owner double-check</span>
                        ) : null}
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
                    {executionNode === null ? null : (
                      <section
                        aria-label={`Decision resource ${executionNode.name}`}
                        className="decision-resource"
                        role="group"
                      >
                        <div className="decision-resource-head">
                          <span>resource</span>
                          <strong>{executionNode.name}</strong>
                          <span className={`pill status-${executionNode.status}`}>{executionNode.status}</span>
                        </div>
                        <dl className="decision-resource-facts">
                          <div>
                            <dt>capacity</dt>
                            <dd>{formatCapacity(executionNode.capacity)}</dd>
                          </div>
                          <div>
                            <dt>tags</dt>
                            <dd>{executionNode.tags.length === 0 ? "none" : executionNode.tags.join(", ")}</dd>
                          </div>
                          {executionNode.proxyUrl ? (
                            <div>
                              <dt>proxy</dt>
                              <dd>{executionNode.proxyUrl}</dd>
                            </div>
                          ) : null}
                          {nodeNote ? (
                            <div>
                              <dt>note</dt>
                              <dd>{nodeNote}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </section>
                    )}
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
                );
              })
            )}
          </div>
        </section>

        <section className="panel overview-worker-panel" hidden={selectedTab !== "overview"}>
          <div className="panel-heading">
            <p className="eyebrow">Operations Summary</p>
            <h2>Active Worker Summary</h2>
          </div>
          <div className="item-list scroll-list compact-list">
            {dashboard.workerSessions.length === 0 ? (
              <p className="empty-copy">No Worker Agent sessions yet.</p>
            ) : (
              <>
                <div className="worker-ops-summary">
                  <span>{runningWorkerCount} running</span>
                  <span>{visibleWorkerSessions.length} active</span>
                  <span>{workerCount} total</span>
                </div>
                {visibleWorkerSessions.length === 0 ? <p className="empty-copy">No active Worker Agent sessions.</p> : null}
                {visibleWorkerSessions.map((session) => (
                  <article className="item-row worker-row compact-row" key={session.id}>
                    <div>
                      <h3>{session.kind}</h3>
                      <p>{displayPath(session.cwd)}</p>
                    </div>
                    <span className={`pill status-${session.status}`}>{session.status}</span>
                  </article>
                ))}
              </>
            )}
          </div>
        </section>

        <section
          aria-label="Worker Report Summary"
          className="panel report-panel"
          hidden={selectedTab !== "overview"}
        >
          <div className="panel-heading">
            <p className="eyebrow">Worker Reports</p>
            <h2>Worker Report Summary</h2>
          </div>
          <div className="item-list scroll-list compact-list">
            {recentWorkerReports.length === 0 ? (
              <p className="empty-copy">No structured Worker reports yet.</p>
            ) : (
              recentWorkerReports.map((report) => {
                const goal = goalById.get(report.goalId) ?? null;
                const session = workerSessionById.get(report.workerSessionId) ?? null;
                const decision = session === null ? null : decisionById.get(session.decisionId) ?? null;

                return (
                  <article className="report-row" key={report.id}>
                    <div className="report-head">
                      <div>
                        <h3>{goal?.title ?? report.goalId}</h3>
                        {decision ? <p>{decision.title}</p> : null}
                      </div>
                      <div className="badge-cluster">
                        <span className={`pill report-status-${report.status.toLowerCase()}`}>{report.status}</span>
                        {report.needsOwnerReview ? <span className="pill review-pill">needs owner review</span> : null}
                      </div>
                    </div>
                    <dl className="report-facts">
                      <div>
                        <dt>verification</dt>
                        <dd>{primaryReportDetail(report.verification)}</dd>
                      </div>
                      <div>
                        <dt>blocker</dt>
                        <dd>{primaryReportDetail(report.blockers)}</dd>
                      </div>
                      <div>
                        <dt>next</dt>
                        <dd>{primaryReportDetail(report.nextActions)}</dd>
                      </div>
                      <div>
                        <dt>files</dt>
                        <dd>{reportFileSummary(report)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section aria-labelledby="worker-sessions-heading" className="panel worker-panel" hidden={selectedTab !== "workers"}>
          <div className="panel-heading">
            <p className="eyebrow">Operations</p>
            <h2 id="worker-sessions-heading">Worker Operations</h2>
          </div>
          <div className="item-list scroll-list compact-list">
            {dashboard.workerSessions.length === 0 ? (
              <p className="empty-copy">No Worker Agent sessions yet.</p>
            ) : (
              <>
                <div className="worker-ops-summary">
                  <span>{runningWorkerCount} running</span>
                  <span>{visibleWorkerSessions.length} active</span>
                  <span>{workerCount} total</span>
                </div>
                {visibleWorkerSessions.length === 0 ? <p className="empty-copy">No active Worker Agent sessions.</p> : null}
                {visibleWorkerSessions.map((session) => (
                  <article className="item-row worker-row compact-row" key={session.id}>
                    <div>
                      <h3>{session.kind}</h3>
                      <p>{displayPath(session.cwd)}</p>
                    </div>
                    <span className={`pill status-${session.status}`}>{session.status}</span>
                  </article>
                ))}
                {visibleWorkerSessions.length > 0 ? (
                  <section className="worker-history">
                    <button
                      aria-expanded={showWorkerDebug}
                      className="worker-disclosure-button"
                      onClick={() => setShowWorkerDebug((current) => !current)}
                      type="button"
                    >
                      <span>Debug details</span>
                      <strong>{visibleWorkerSessions.length} active sessions</strong>
                    </button>
                    {showWorkerDebug ? (
                      <div aria-label="Worker debug details" className="worker-history-list" role="group">
                        {visibleWorkerSessions.map((session) => (
                          <article className="worker-history-row" key={session.id}>
                            <div className="worker-history-main">
                              <h3>{session.kind} session</h3>
                              <dl className="debug-facts">
                                <div>
                                  <dt>command</dt>
                                  <dd>{session.command}</dd>
                                </div>
                                <div>
                                  <dt>cwd</dt>
                                  <dd>{displayPath(session.cwd)}</dd>
                                </div>
                                {session.pid ? (
                                  <div>
                                    <dt>pid</dt>
                                    <dd>pid {session.pid}</dd>
                                  </div>
                                ) : null}
                                {session.resumeId ? (
                                  <div>
                                    <dt>resume</dt>
                                    <dd>{resumeCommand(session.command, session.resumeId)}</dd>
                                  </div>
                                ) : null}
                              </dl>
                              {session.lastOutput ? <pre>{session.lastOutput}</pre> : null}
                            </div>
                            <div className="worker-history-meta">
                              <span className={`pill status-${session.status}`}>{session.status}</span>
                              {session.resumeId ? <span>resume {session.resumeId}</span> : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {historicalWorkerSessions.length > 0 ? (
                  <section className="worker-history">
                    <button
                      aria-expanded={showWorkerHistory}
                      className="worker-disclosure-button"
                      onClick={() => setShowWorkerHistory((current) => !current)}
                      type="button"
                    >
                      <span>History</span>
                      <strong>{historicalWorkerSessions.length} historical sessions</strong>
                    </button>
                    {showWorkerHistory ? (
                      <div aria-label="Historical Worker sessions" className="worker-history-list" role="group">
                        {historicalWorkerSessions.map((session) => (
                          <article className="worker-history-row" key={session.id}>
                            <div className="worker-history-main">
                              <h3>{session.kind} session</h3>
                              <dl className="debug-facts">
                                <div>
                                  <dt>command</dt>
                                  <dd>{session.command}</dd>
                                </div>
                                <div>
                                  <dt>cwd</dt>
                                  <dd>{displayPath(session.cwd)}</dd>
                                </div>
                                {session.pid ? (
                                  <div>
                                    <dt>pid</dt>
                                    <dd>pid {session.pid}</dd>
                                  </div>
                                ) : null}
                                {session.resumeId ? (
                                  <div>
                                    <dt>resume</dt>
                                    <dd>{resumeCommand(session.command, session.resumeId)}</dd>
                                  </div>
                                ) : null}
                              </dl>
                              {session.lastOutput ? <pre>{session.lastOutput}</pre> : null}
                            </div>
                            <div className="worker-history-meta">
                              <span className={`pill status-${session.status}`}>{session.status}</span>
                              {session.resumeId ? <span>resume {session.resumeId}</span> : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="panel recovery-panel" hidden={selectedTab !== "recovery"}>
          <div className="panel-heading">
            <p className="eyebrow">Recovery Context</p>
            <h2>Recovery Context</h2>
          </div>
          <section aria-label="Owner recovery actions" className="owner-action-strip">
            <button
              disabled={ownerActionRunning !== null}
              onClick={() => void runOwnerAction("autonomy")}
              type="button"
            >
              {ownerActionRunning === "autonomy" ? "Running autonomy..." : "Run autonomy tick"}
            </button>
            <button
              className="secondary-button"
              disabled={ownerActionRunning !== null}
              onClick={() => void runOwnerAction("reconcile")}
              type="button"
            >
              {ownerActionRunning === "reconcile" ? "Reconciling..." : "Reconcile recovery"}
            </button>
          </section>
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
                <h2>Checkpoints</h2>
              </div>
              <div className="item-list scroll-list mini-list">
                {dashboard.stewardCheckpoints.length === 0 ? (
                  <p className="empty-copy">No Steward checkpoints recorded.</p>
                ) : (
                  dashboard.stewardCheckpoints.map((checkpoint) => (
                    <article className="event-row compact-event-row" key={checkpoint.id}>
                      <div className="event-head">
                        <h3>{checkpoint.reason}</h3>
                        <time dateTime={checkpoint.createdAt}>{formatEventTime(checkpoint.createdAt)}</time>
                      </div>
                      <p>{checkpoint.summary}</p>
                      <dl className="resource-facts compact-facts">
                        <div>
                          <dt>next</dt>
                          <dd>{checkpoint.nextAction}</dd>
                        </div>
                        <div>
                          <dt>goals</dt>
                          <dd>{checkpoint.goalIds.length}</dd>
                        </div>
                        <div>
                          <dt>workers</dt>
                          <dd>{checkpoint.workerSessionIds.length}</dd>
                        </div>
                      </dl>
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

        <details className="panel node-panel secondary-panel" hidden={selectedTab !== "resources"} open>
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
                      {executionNodeNote(node) ? (
                        <div>
                          <dt>note</dt>
                          <dd>{executionNodeNote(node)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                  <span className={`pill status-${node.status}`}>{node.status}</span>
                </article>
              ))
            )}
          </div>
        </details>

        <details className="panel memory-panel secondary-panel" hidden={selectedTab !== "resources"} open>
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
      </section>
    </main>
  );
}
