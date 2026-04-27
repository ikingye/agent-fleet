import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { ExecutionNode, StewardDecision, WorkerReport, WorkerSession } from "../shared/types.js";
import { filterKnownPlatformNoise } from "../shared/outputSanitizer.js";
import {
  type ClientDashboardData,
  type ClientConversation,
  type ClientExecutionNode,
  correctDecision,
  createGoal,
  fetchConversationMessages,
  fetchConversations,
  fetchDashboard,
  reconcileRecovery,
  registerExecutionNode,
  runAutonomyTick,
  sendStewardConversationMessage
} from "./api.js";
import {
  buildCockpitBrief,
  buildInboxItems,
  buildProjectSummaries,
  type InboxItem,
  type ProjectSummary
} from "./viewModels/cockpit.js";

const emptyDashboard: ClientDashboardData = {
  goals: [],
  decisions: [],
  workerSessions: [],
  corrections: [],
  memories: [],
  executionNodes: [],
  githubDeployKeyLeases: [],
  worktreeAssignments: [],
  stewardCheckpoints: [],
  workerReports: [],
  agentArtifacts: [],
  reviews: [],
  deliveryReports: [],
  stewardMessages: [],
  events: []
};

type GlobalWithOptionalProcess = typeof globalThis & {
  process?: {
    env?: {
      HOME?: string;
    };
  };
};

function displayPath(path: string): string {
  const homePath = homePathPrefix(path);

  if (homePath === null) {
    return path;
  }

  if (path === homePath) {
    return "~";
  }

  if (path.startsWith(`${homePath}/`)) {
    return `~/${path.slice(homePath.length + 1)}`;
  }

  return path;
}

function displayText(value: string): string {
  return filterKnownPlatformNoise(redactGenericHomePaths(redactCurrentHomePath(value)));
}

function homePathPrefix(path: string): string | null {
  const currentHomePath = currentHomePathPrefix();

  if (currentHomePath !== null && (path === currentHomePath || path.startsWith(`${currentHomePath}/`))) {
    return currentHomePath;
  }

  return path.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/)?.[0] ?? null;
}

function currentHomePathPrefix(): string | null {
  const homePath = (globalThis as GlobalWithOptionalProcess).process?.env?.HOME?.trim();

  if (!homePath?.startsWith("/")) {
    return null;
  }

  const normalizedHomePath = homePath.replace(/\/+$/, "");
  return normalizedHomePath === "" ? null : normalizedHomePath;
}

function redactCurrentHomePath(value: string): string {
  const currentHomePath = currentHomePathPrefix();

  if (currentHomePath === null) {
    return value;
  }

  return value.replace(homeTextPattern(currentHomePath), (_match, leadingBoundary: string) => `${leadingBoundary}~`);
}

function redactGenericHomePaths(value: string): string {
  return value.replace(
    /(^|[^A-Za-z0-9._~/-])(\/(?:Users|home)\/[^/\s"'`]+)(?=\/|$|[\s.,;:!?)}\]])/g,
    (_match, leadingBoundary: string) => `${leadingBoundary}~`
  );
}

function homeTextPattern(homePath: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9._~/-])${escapeRegExp(homePath)}(?=/|$|[\\s.,;:!?)}\\]])`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function conversationLabel(conversation: ClientConversation): string {
  const title = conversation.title?.trim() || conversation.projectName?.trim() || "Steward conversation";

  return conversation.workspacePath ? `${title} - ${displayPath(conversation.workspacePath)}` : title;
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
  return displayText(values[0] ?? "No detail recorded.");
}

function reportFileSummary(report: WorkerReport): string {
  if (report.changedFiles.length === 0) {
    return "No files listed.";
  }

  return displayText(report.changedFiles.slice(0, 3).join(", "));
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type DashboardTab = "chat" | "projects" | "goals" | "inbox" | "workers" | "recovery" | "remote" | "memory" | "help";

const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "projects", label: "Projects" },
  { id: "inbox", label: "Inbox" },
  { id: "goals", label: "Goals" },
  { id: "workers", label: "Workers" },
  { id: "recovery", label: "Recovery" },
  { id: "remote", label: "Remote" },
  { id: "memory", label: "Memory" },
  { id: "help", label: "Help" }
];

export function App() {
  const [dashboard, setDashboard] = useState<ClientDashboardData>(emptyDashboard);
  const [selectedTab, setSelectedTab] = useState<DashboardTab>("chat");
  const [projectName, setProjectName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalBody, setGoalBody] = useState("");
  const [stewardMessageBody, setStewardMessageBody] = useState("");
  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [conversationApiAvailable, setConversationApiAvailable] = useState<boolean | null>(null);
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
  const remoteReadyCount = useMemo(() => remoteNodes.filter((node) => node.status === "ready").length, [remoteNodes]);
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
  const inboxItems = useMemo(() => buildInboxItems(dashboard), [dashboard]);
  const projectSummaries = useMemo(() => buildProjectSummaries(dashboard, inboxItems), [dashboard, inboxItems]);
  const currentBrief = useMemo(
    () => buildCockpitBrief(dashboard, projectSummaries, inboxItems, { projectName, workspacePath }),
    [dashboard, inboxItems, projectName, projectSummaries, workspacePath]
  );
  const memoryCount = dashboard.memories.length;
  const goalCount = dashboard.goals.length;
  const workerCount = dashboard.workerSessions.length;

  async function applyDashboardData(nextDashboard: ClientDashboardData, preferredConversationId = selectedConversationId) {
    const nextConversations = await fetchConversations();

    if (nextConversations === null) {
      setConversationApiAvailable(false);
      setConversations([]);
      setSelectedConversationId("");
      setDashboard(nextDashboard);
      return;
    }

    setConversationApiAvailable(true);
    setConversations(nextConversations);

    const nextSelectedConversationId = nextConversations.some(
      (conversation) => conversation.id === preferredConversationId
    )
      ? preferredConversationId
      : nextConversations[0]?.id ?? "";

    setSelectedConversationId(nextSelectedConversationId);

    if (nextSelectedConversationId === "") {
      setDashboard(nextDashboard);
      return;
    }

    const conversationMessages = await fetchConversationMessages(nextSelectedConversationId);

    setDashboard({
      ...nextDashboard,
      stewardMessages: conversationMessages ?? nextDashboard.stewardMessages
    });
  }

  async function refresh(preferredConversationId = selectedConversationId) {
    const nextDashboard = await fetchDashboard();
    await applyDashboardData(nextDashboard, preferredConversationId);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;

    fetchDashboard()
      .then(async (nextDashboard) => {
        if (mounted) {
          await applyDashboardData(nextDashboard, selectedConversationId);
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

  async function changeConversation(conversationId: string) {
    setSelectedConversationId(conversationId);

    if (conversationId === "") {
      return;
    }

    try {
      const conversationMessages = await fetchConversationMessages(conversationId);

      if (conversationMessages === null) {
        setConversationApiAvailable(false);
        return;
      }

      setDashboard((currentDashboard) => ({
        ...currentDashboard,
        stewardMessages: conversationMessages
      }));
      setError(null);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Failed to load conversation.");
    }
  }

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
    const targetWorkspacePath = workspacePath.trim();

    if (body === "") {
      setError("Steward message cannot be empty.");
      return;
    }

    if (targetWorkspacePath === "") {
      setError("Target directory is required before messaging the Steward.");
      return;
    }

    try {
      await sendStewardConversationMessage(
        {
          body,
          ...(projectName.trim() === "" ? {} : { projectName: projectName.trim() }),
          workspacePath: targetWorkspacePath
        },
        selectedConversationId
      );
      setStewardMessageBody("");
      await refresh(selectedConversationId);
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

  function tabBadgeCount(tab: DashboardTab): number | null {
    if (tab === "chat") {
      return ownerFacingMessages.length;
    }

    if (tab === "projects") {
      return projectSummaries.length;
    }

    if (tab === "inbox") {
      return inboxItems.length;
    }

    if (tab === "workers") {
      return visibleWorkerSessions.length;
    }

    if (tab === "memory") {
      return memoryCount;
    }

    return null;
  }

  function renderTopContext() {
    return (
      <section aria-label="Steward context" className="top-context">
        <span>{countLabel(goalCount, "goal")}</span>
        <span>{runningWorkerCount === 1 ? "1 Worker running" : `${runningWorkerCount} Workers running`}</span>
        <span>{countLabel(humanReviewCount, "review")}</span>
        <span>{countLabel(remoteReadyCount, "remote ready", "remote ready")}</span>
      </section>
    );
  }

  function renderMetricGrid() {
    return (
      <section className="metric-grid" aria-label="supervision metrics" hidden={selectedTab === "chat"}>
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
    );
  }

  function renderCurrentBriefPanel() {
    return (
      <section aria-label="Current Brief" className="panel console-status-panel">
        <div className="panel-heading">
          <p className="eyebrow">Steward Cockpit</p>
          <h2>Current Brief</h2>
        </div>
        <div className="console-status-list">
          <article className="console-status-card">
            <span>Project</span>
            <strong>{displayText(currentBrief.projectName)}</strong>
            <p>{currentBrief.workspacePath === null ? "No workspace selected" : displayPath(currentBrief.workspacePath)}</p>
          </article>
          <article className="console-status-card">
            <span>Active Goal</span>
            <strong>{currentBrief.activeGoalTitle === "No active goal selected." ? "-" : "1"}</strong>
            <p>{displayText(currentBrief.activeGoalTitle)}</p>
          </article>
          <article className="console-status-card">
            <span>Human Review</span>
            <strong>{currentBrief.humanReviewCount}</strong>
            <p>
              {currentBrief.humanReviewCount === 1
                ? "1 decision for review"
                : `${currentBrief.humanReviewCount} decisions for review`}
            </p>
          </article>
          <article className="console-status-card">
            <span>Running Workers</span>
            <strong>{currentBrief.runningWorkerCount}</strong>
            <p>{currentBrief.runningWorkerCount === 1 ? "1 Worker running" : `${currentBrief.runningWorkerCount} Workers running`}</p>
          </article>
          <article className="console-status-card">
            <span>Remote Capacity</span>
            <strong>{currentBrief.remoteReadyCount}</strong>
            <p>
              {currentBrief.remoteReadyCount === 1
                ? "1 remote node ready"
                : `${currentBrief.remoteReadyCount} remote nodes ready`}
            </p>
          </article>
        </div>
        <section className="console-brief" aria-label="Next safe action">
          <div className="console-brief-heading">
            <span>Next safe action</span>
            {inboxItems.length > 0 ? <strong className="pill review-pill">{inboxItems.length} queued</strong> : null}
          </div>
          <p>{displayText(currentBrief.nextSafeAction)}</p>
        </section>
      </section>
    );
  }

  function renderGoalIntakePanel() {
    return (
      <section className="panel intake-panel" hidden={selectedTab !== "goals"}>
        <div className="panel-heading">
          <p className="eyebrow">Human Intent</p>
          <h2>Steward Intake</h2>
        </div>
        <form className="stack-form" onSubmit={(event) => void submitGoal(event)}>
          <input
            aria-label={selectedTab === "goals" ? "Project" : undefined}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Project"
            type="text"
            value={projectName}
          />
          <input
            aria-label={selectedTab === "goals" ? "Target directory" : undefined}
            aria-describedby="target-directory-hint"
            onChange={(event) => setWorkspacePath(event.target.value)}
            placeholder="~/code/project/target"
            required
            type="text"
            value={workspacePath}
          />
          <p className="field-hint" id="target-directory-hint">
            {selectedTab === "goals" ? "External workspace path required" : ""}
          </p>
          <input
            aria-label={selectedTab === "goals" ? "Goal title" : undefined}
            onChange={(event) => setGoalTitle(event.target.value)}
            placeholder="Goal title"
            type="text"
            value={goalTitle}
          />
          <textarea
            aria-label={selectedTab === "goals" ? "Goal body" : undefined}
            onChange={(event) => setGoalBody(event.target.value)}
            placeholder="Goal, constraints, acceptance criteria"
            value={goalBody}
          />
          <button type="submit">Start Steward</button>
        </form>
      </section>
    );
  }

  function renderStewardConsole() {
    return (
      <section aria-label="Steward console" className="steward-console" hidden={selectedTab !== "chat"}>
        <section className="panel chat-panel">
          <div className="panel-heading conversation-heading">
            <div>
              <p className="eyebrow">Durable Conversation</p>
              <h2>Steward Chat</h2>
            </div>
            {conversationApiAvailable === true && conversations.length > 0 ? (
              <label className="conversation-select">
                <span>Conversation</span>
                <select
                  aria-label="Conversation"
                  onChange={(event) => void changeConversation(event.target.value)}
                  value={selectedConversationId}
                >
                  {conversations.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {conversationLabel(conversation)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                  <p>{displayText(message.body)}</p>
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
                        <p>{displayText(message.body)}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <form className="stack-form chat-form" onSubmit={(event) => void submitStewardMessage(event)}>
            <div className="chat-context-grid">
              <input
                aria-label={selectedTab === "chat" ? "Project" : undefined}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Project"
                type="text"
                value={projectName}
              />
              <input
                aria-label={selectedTab === "chat" ? "Target directory" : undefined}
                aria-describedby="chat-target-directory-hint"
                onChange={(event) => setWorkspacePath(event.target.value)}
                placeholder="~/code/project/target"
                type="text"
                value={workspacePath}
              />
            </div>
            <p className="field-hint" id="chat-target-directory-hint">
              {selectedTab === "chat" ? "External workspace path required" : ""}
            </p>
            <textarea
              aria-label={selectedTab === "chat" ? "Message Steward" : undefined}
              onChange={(event) => setStewardMessageBody(event.target.value)}
              placeholder="Message the Steward Agent"
              value={stewardMessageBody}
            />
            <button type="submit">Send to Steward</button>
          </form>
        </section>
        {renderCurrentBriefPanel()}
      </section>
    );
  }

  function renderProjectsPanel() {
    return (
      <section className="panel projects-panel" hidden={selectedTab !== "projects"}>
        <div className="panel-heading">
          <p className="eyebrow">Multi-project cockpit</p>
          <h2>Projects</h2>
        </div>
        <div className="item-list scroll-list project-list">
          {projectSummaries.length === 0 ? (
            <p className="empty-copy">No projects accepted yet.</p>
          ) : (
            projectSummaries.map((project) => renderProjectCard(project))
          )}
        </div>
      </section>
    );
  }

  function renderProjectCard(project: ProjectSummary) {
    const latestActiveGoal = project.goals.find((goal) => goal.status === "running" || goal.status === "blocked") ?? project.goals[0] ?? null;

    return (
      <article aria-label={`Project ${project.projectName}`} className="project-card" key={project.id} role="group">
        <div className="project-card-head">
          <div>
            <h3>{displayText(project.projectName)}</h3>
            {project.workspacePath ? <p>{displayPath(project.workspacePath)}</p> : <p>No workspace recorded.</p>}
          </div>
          <div className="badge-cluster">
            <span className="pill">{countLabel(project.activeGoalCount, "active goal")}</span>
            <span className="pill">
              {project.runningWorkerCount === 1 ? "1 running Worker" : `${project.runningWorkerCount} running Workers`}
            </span>
          </div>
        </div>
        <dl className="project-facts">
          <div>
            <dt>active goal</dt>
            <dd>{latestActiveGoal === null ? "No active goal." : displayText(latestActiveGoal.title)}</dd>
          </div>
          <div>
            <dt>latest decision</dt>
            <dd>{project.latestDecisionTitle === null ? "No Steward decision yet." : displayText(project.latestDecisionTitle)}</dd>
          </div>
          <div>
            <dt>latest Worker report</dt>
            <dd>
              {project.latestWorkerReportStatus === null
                ? "No Worker report yet."
                : `${project.latestWorkerReportStatus}: ${displayText(project.latestWorkerReportTitle ?? "No report title.")}`}
            </dd>
          </div>
          <div>
            <dt>next owner action</dt>
            <dd>{displayText(project.nextOwnerAction)}</dd>
          </div>
        </dl>
      </article>
    );
  }

  function renderInboxPanel() {
    return (
      <section className="panel inbox-panel" hidden={selectedTab !== "inbox"}>
        <div className="panel-heading">
          <p className="eyebrow">Owner action queue</p>
          <h2>Owner Inbox</h2>
        </div>
        <div className="item-list scroll-list inbox-list">
          {inboxItems.length === 0 ? (
            <p className="empty-copy">No owner-visible actions queued.</p>
          ) : (
            inboxItems.map((item) => renderInboxItem(item))
          )}
        </div>
      </section>
    );
  }

  function renderInboxItem(item: InboxItem) {
    const goal = goalById.get(item.goalId) ?? null;

    return (
      <article className="inbox-row" key={item.id}>
        <div className="inbox-row-head">
          <div>
            <h3>{displayText(item.title)}</h3>
            <p>{displayText(item.summary)}</p>
          </div>
          <div className="badge-cluster">
            <span className="pill">{item.kind === "decision" ? "Steward decision" : "Worker report"}</span>
            {item.risk ? <span className={`pill risk-${item.risk}`}>{item.risk}</span> : null}
            <span className="pill review-pill">{item.reason}</span>
          </div>
        </div>
        <dl className="inbox-facts">
          <div>
            <dt>project</dt>
            <dd>{goal === null ? item.goalId : displayText(goal.projectName)}</dd>
          </div>
          <div>
            <dt>workspace</dt>
            <dd>{goal?.workspacePath ? displayPath(goal.workspacePath) : "No workspace recorded."}</dd>
          </div>
          <div>
            <dt>goal</dt>
            <dd>{goal === null ? item.goalId : displayText(goal.title)}</dd>
          </div>
          <div>
            <dt>status</dt>
            <dd>{item.status}</dd>
          </div>
        </dl>
      </article>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            AF
          </span>
          <div>
            <p className="eyebrow">Steward Control Plane</p>
            <h1>agent-fleet</h1>
          </div>
        </div>
        <nav aria-label="Control plane sections" className="sidebar-nav">
          <div aria-orientation="vertical" role="tablist">
            {dashboardTabs.map((tab) => (
              <button
                aria-label={tab.label}
                aria-controls={`${tab.id}-panel`}
                aria-selected={selectedTab === tab.id}
                className={selectedTab === tab.id ? "tab-button active-tab" : "tab-button"}
                id={`${tab.id}-tab`}
                key={tab.id}
                onClick={() => setSelectedTab(tab.id)}
                role="tab"
                type="button"
              >
                <span>{tab.label}</span>
                {tabBadgeCount(tab.id) === null ? null : <strong>{tabBadgeCount(tab.id)}</strong>}
              </button>
            ))}
          </div>
        </nav>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{dashboardTabs.find((tab) => tab.id === selectedTab)?.label ?? "Dashboard"}</p>
            <p className="topbar-title">{selectedTab === "chat" ? "Steward conversation" : "agent-fleet control plane"}</p>
          </div>
          {renderTopContext()}
          <button className="secondary-button" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        </header>

        {error ? (
          <section className="error-banner" role="alert">
            {error}
          </section>
        ) : null}

        <section
          aria-labelledby={`${selectedTab}-tab`}
          className="tab-panel"
          id={`${selectedTab}-panel`}
          role="tabpanel"
        >
          {renderMetricGrid()}

          <section className={`dashboard-grid tab-${selectedTab}`} aria-label="agent-fleet dashboard">
            {renderGoalIntakePanel()}
            {renderStewardConsole()}
            {renderProjectsPanel()}
            {renderInboxPanel()}

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
                    <p>{displayText(goal.body)}</p>
                  </div>
                  <span className={`pill status-${goal.status}`}>{goal.status}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel decision-panel" hidden={selectedTab !== "inbox"}>
          <div className="panel-heading">
            <p className="eyebrow">Decision review</p>
            <h2>Steward Decisions</h2>
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
                        <p>{displayText(decision.rationale)}</p>
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
                      <p className="action-summary">{displayText(actions(decision).join(" | "))}</p>
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

        <section className="panel overview-worker-panel" hidden={true}>
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
          hidden={selectedTab !== "inbox"}
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
                              {session.lastOutput ? <pre>{displayText(session.lastOutput)}</pre> : null}
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
                              {session.lastOutput ? <pre>{displayText(session.lastOutput)}</pre> : null}
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
                      <p>{displayText(checkpoint.summary)}</p>
                      <dl className="resource-facts compact-facts">
                        <div>
                          <dt>next</dt>
                          <dd>{displayText(checkpoint.nextAction)}</dd>
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
                      <p>{displayText(event.message)}</p>
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

        <details className="panel node-panel secondary-panel" hidden={selectedTab !== "remote"} open>
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

        <details className="panel memory-panel secondary-panel" hidden={selectedTab !== "memory"} open>
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
                    <p>{displayText(memory.value)}</p>
                  </div>
                  <span className="pill">{memory.scope}</span>
                </article>
              ))
            )}
          </div>
        </details>

        <section className="panel docs-panel" hidden={selectedTab !== "help"}>
          <div className="panel-heading">
            <p className="eyebrow">Operator Handbook</p>
            <h2>Help</h2>
          </div>
          <div className="docs-links">
            <a href="https://ikingye.github.io/agent-fleet/" rel="noreferrer">
              GitHub Pages
            </a>
            <a href="https://github.com/ikingye/agent-fleet/tree/main/docs" rel="noreferrer">
              Source docs
            </a>
            <a href="https://github.com/ikingye/agent-fleet" rel="noreferrer">
              GitHub repository
            </a>
          </div>
        </section>
      </section>
      </section>
      </section>
    </main>
  );
}
