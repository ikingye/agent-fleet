import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Project,
  RemoteHost,
  RemoteProxyMode,
  Repository,
  Task,
  TaskEvent,
  TaskState
} from "../../shared/types.js";

type TaskActor = TaskEvent["actor"];
type TaskSource = Task["source"];
type Metadata = Record<string, unknown>;

interface RepositoryRow {
  id: string;
  project_id: string;
  name: string;
  root_path: string;
  remote_url: string | null;
  main_branch: string;
  created_at: string;
}

interface RemoteHostRow {
  id: string;
  name: string;
  ssh_host: string;
  work_root: string;
  proxy_mode: RemoteProxyMode;
  proxy_url: string | null;
  local_forward_port: number | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  repository_id: string;
  title: string;
  goal: string;
  state: TaskState;
  source: TaskSource;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  actor: TaskActor;
  state: TaskState;
  message: string;
  metadata_json: string;
  created_at: string;
}

export interface CreateRepositoryInput {
  projectId: string;
  name: string;
  rootPath: string;
  remoteUrl: string | null;
  mainBranch: string;
}

export interface CreateRemoteHostInput {
  name: string;
  sshHost: string;
  workRoot: string;
  proxyMode: RemoteProxyMode;
  proxyUrl: string | null;
  localForwardPort: number | null;
}

export interface CreateTaskInput {
  repositoryId: string;
  title: string;
  goal: string;
  source: TaskSource;
  sourceUrl: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function mapRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    rootPath: row.root_path,
    remoteUrl: row.remote_url,
    mainBranch: row.main_branch,
    createdAt: row.created_at
  };
}

function mapRemoteHost(row: RemoteHostRow): RemoteHost {
  return {
    id: row.id,
    name: row.name,
    sshHost: row.ssh_host,
    workRoot: row.work_root,
    proxyMode: row.proxy_mode,
    proxyUrl: row.proxy_url,
    localForwardPort: row.local_forward_port,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    title: row.title,
    goal: row.goal,
    state: row.state,
    source: row.source,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    actor: row.actor,
    state: row.state,
    message: row.message,
    metadataJson: row.metadata_json,
    createdAt: row.created_at
  };
}

export class RepositoryStore {
  constructor(private db: DatabaseSync) {}

  createProject(name: string): Project {
    const project: Project = {
      id: randomUUID(),
      name,
      createdAt: now()
    };

    this.db
      .prepare("insert into projects (id, name, created_at) values (?, ?, ?)")
      .run(project.id, project.name, project.createdAt);

    return project;
  }

  createRepository(input: CreateRepositoryInput): Repository {
    const repository: Repository = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      rootPath: input.rootPath,
      remoteUrl: input.remoteUrl,
      mainBranch: input.mainBranch,
      createdAt: now()
    };

    this.db
      .prepare(
        `
        insert into repositories (id, project_id, name, root_path, remote_url, main_branch, created_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        repository.id,
        repository.projectId,
        repository.name,
        repository.rootPath,
        repository.remoteUrl,
        repository.mainBranch,
        repository.createdAt
      );

    return repository;
  }

  getRepository(id: string): Repository | null {
    const row = this.db
      .prepare("select * from repositories where id = ?")
      .get(id) as RepositoryRow | undefined;

    return row === undefined ? null : mapRepository(row);
  }

  listRepositories(projectId?: string): Repository[] {
    const rows =
      projectId === undefined
        ? (this.db
            .prepare("select * from repositories order by created_at asc, id asc")
            .all() as unknown as RepositoryRow[])
        : (this.db
            .prepare("select * from repositories where project_id = ? order by created_at asc, id asc")
            .all(projectId) as unknown as RepositoryRow[]);

    return rows.map(mapRepository);
  }

  createRemoteHost(input: CreateRemoteHostInput): RemoteHost {
    const timestamp = now();
    const host: RemoteHost = {
      id: randomUUID(),
      name: input.name,
      sshHost: input.sshHost,
      workRoot: input.workRoot,
      proxyMode: input.proxyMode,
      proxyUrl: input.proxyUrl,
      localForwardPort: input.localForwardPort,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db
      .prepare(
        `
        insert into remote_hosts
          (id, name, ssh_host, work_root, proxy_mode, proxy_url, local_forward_port, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        host.id,
        host.name,
        host.sshHost,
        host.workRoot,
        host.proxyMode,
        host.proxyUrl,
        host.localForwardPort,
        host.createdAt,
        host.updatedAt
      );

    return host;
  }

  getRemoteHost(id: string): RemoteHost | null {
    const row = this.db.prepare("select * from remote_hosts where id = ?").get(id) as RemoteHostRow | undefined;

    return row === undefined ? null : mapRemoteHost(row);
  }

  listRemoteHosts(): RemoteHost[] {
    const rows = this.db
      .prepare("select * from remote_hosts order by created_at asc, id asc")
      .all() as unknown as RemoteHostRow[];

    return rows.map(mapRemoteHost);
  }

  createTask(input: CreateTaskInput): Task {
    const timestamp = now();
    const task: Task = {
      id: randomUUID(),
      repositoryId: input.repositoryId,
      title: input.title,
      goal: input.goal,
      state: "queued",
      source: input.source,
      sourceUrl: input.sourceUrl,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
          insert into tasks (id, repository_id, title, goal, state, source, source_url, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          task.id,
          task.repositoryId,
          task.title,
          task.goal,
          task.state,
          task.source,
          task.sourceUrl,
          task.createdAt,
          task.updatedAt
        );
      this.appendTaskEvent(task.id, "user", "queued", "Task queued", {});
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("select * from tasks where id = ?").get(id) as TaskRow | undefined;

    return row === undefined ? null : mapTask(row);
  }

  listTasks(repositoryId?: string): Task[] {
    const rows =
      repositoryId === undefined
        ? (this.db.prepare("select * from tasks order by created_at asc, id asc").all() as unknown as TaskRow[])
        : (this.db
            .prepare("select * from tasks where repository_id = ? order by created_at asc, id asc")
            .all(repositoryId) as unknown as TaskRow[]);

    return rows.map(mapTask);
  }

  listQueuedTasks(limit = 1): Task[] {
    const rows = this.db
      .prepare("select * from tasks where state = ? order by created_at asc, id asc limit ?")
      .all("queued", limit) as unknown as TaskRow[];

    return rows.map(mapTask);
  }

  transitionTask(
    taskId: string,
    state: TaskState,
    actor: TaskActor,
    message: string,
    metadata: Metadata = {}
  ): Task {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("update tasks set state = ?, updated_at = ? where id = ?")
        .run(state, now(), taskId);
      this.appendTaskEvent(taskId, actor, state, message, metadata);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const task = this.getTask(taskId);
    if (task === null) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return task;
  }

  appendTaskEvent(
    taskId: string,
    actor: TaskActor,
    state: TaskState,
    message: string,
    metadata: Metadata = {}
  ): TaskEvent {
    const event: TaskEvent = {
      id: randomUUID(),
      taskId,
      actor,
      state,
      message,
      metadataJson: JSON.stringify(metadata),
      createdAt: now()
    };

    this.db
      .prepare(
        `
        insert into task_events (id, task_id, actor, state, message, metadata_json, created_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        event.id,
        event.taskId,
        event.actor,
        event.state,
        event.message,
        event.metadataJson,
        event.createdAt
      );

    return event;
  }

  listTaskEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare("select * from task_events where task_id = ? order by rowid asc")
      .all(taskId) as unknown as TaskEventRow[];

    return rows.map(mapTaskEvent);
  }
}
