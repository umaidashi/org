import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { attachArtifact, changeTask, isTaskStatus, validateTaskReferences } from './domain.js';
import type { Task, TaskPatch, TaskArtifact, TaskComment } from './domain.js';
import type { IdempotentTaskWriter, TaskFilter, TaskHistory, TaskProvider } from './port.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored task string');
  return value;
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Invalid stored task references');
  return value.map((entry: unknown) => text(entry));
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}
function decode(raw: unknown): Task {
  const value: unknown = JSON.parse(text(raw));
  if (
    !record(value) ||
    !isTaskStatus(value.status) ||
    (value.kind !== 'work_item' && value.kind !== 'execution_task') ||
    typeof value.priority !== 'number' ||
    typeof value.version !== 'number'
  )
    throw new Error('Invalid stored task');
  return {
    id: text(value.id),
    kind: value.kind,
    title: text(value.title),
    objective: text(value.objective),
    status: value.status,
    priority: value.priority,
    version: value.version,
    owner: nullable(value.owner),
    parentId: nullable(value.parentId),
    dependencies: strings(value.dependencies),
    labels: strings(value.labels),
    inputArtifacts: strings(value.inputArtifacts),
    outputArtifacts: strings(value.outputArtifacts),
    externalRef: nullable(value.externalRef),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
  };
}
export class SqliteTaskProvider implements TaskProvider, IdempotentTaskWriter {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA busy_timeout = 5000');
    try {
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_history (task_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(task_id, version));
        CREATE TABLE IF NOT EXISTS task_comments (task_id TEXT NOT NULL, id TEXT PRIMARY KEY, body TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_artifacts (task_id TEXT NOT NULL, id TEXT NOT NULL, uri TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(task_id, id));
        CREATE TRIGGER IF NOT EXISTS task_history_no_update BEFORE UPDATE ON task_history BEGIN SELECT RAISE(ABORT, 'Task history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS task_history_no_delete BEFORE DELETE ON task_history BEGIN SELECT RAISE(ABORT, 'Task history is immutable'); END;`);
      for (const table of ['task_comments', 'task_artifacts']) {
        for (const operation of ['UPDATE', 'DELETE']) {
          this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()}
            BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'Task original is immutable'); END;`);
        }
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private validateReferences(task: Task): void {
    validateTaskReferences(task, this.list());
  }
  private append(task: Task): void {
    this.db
      .prepare<Record<string, unknown>, (string | number)[]>(
        'INSERT INTO task_history (task_id, version, status, data) VALUES (?, ?, ?, ?)',
      )
      .run(task.id, task.version, task.status, JSON.stringify(task));
  }
  create(task: Task): void {
    this.transaction(() => {
      this.validateReferences(task);
      this.db
        .prepare<Record<string, unknown>, (string | number)[]>(
          'INSERT INTO tasks (id, version, data) VALUES (?, ?, ?)',
        )
        .run(task.id, task.version, JSON.stringify(task));
      this.append(task);
    });
  }
  createAssignedOnce(task: Task, owner: string, at: string): Task {
    if (task.status !== 'pending' || task.owner !== null || task.version !== 0)
      throw new Error('Idempotent creation requires a new pending Task');
    const assigned = changeTask(task, { owner }, at);
    return this.transaction(() => {
      const row = this.db.query('SELECT data FROM tasks WHERE id=?').get(task.id);
      if (row) {
        const history = this.history(task.id);
        const original = history[0]?.task;
        const firstAssignment = history[1]?.task;
        const canonical = (value: Task | undefined) =>
          value === undefined ? '' : JSON.stringify(decode(JSON.stringify(value)));
        if (
          canonical(original) !== canonical(task) ||
          canonical(firstAssignment) !== canonical(assigned)
        )
          throw new Error('Task idempotency conflict');
        return this.get(task.id);
      }
      this.validateReferences(task);
      this.db
        .query('INSERT INTO tasks(id, version, data) VALUES (?, ?, ?)')
        .run(task.id, task.version, JSON.stringify(task));
      this.append(task);
      this.validateReferences(assigned);
      this.db
        .query('UPDATE tasks SET version=?, data=? WHERE id=?')
        .run(assigned.version, JSON.stringify(assigned), task.id);
      this.append(assigned);
      return assigned;
    });
  }
  get(id: string): Task {
    const row = this.db
      .prepare<Record<string, unknown>, (string | number)[]>('SELECT data FROM tasks WHERE id = ?')
      .get(id);
    if (!row) throw new Error(`Task ${JSON.stringify(id)} not found`);
    return decode(row.data);
  }
  update(id: string, patch: TaskPatch, at: string, expectedVersion?: number): Task {
    return this.transaction(() => {
      const current = this.get(id);
      if (expectedVersion !== undefined && current.version !== expectedVersion)
        throw new Error('Task version conflict');
      const task = changeTask(current, patch, at);
      this.validateReferences(task);
      this.db
        .prepare<Record<string, unknown>, (string | number)[]>(
          'UPDATE tasks SET version = ?, data = ? WHERE id = ?',
        )
        .run(task.version, JSON.stringify(task), id);
      this.append(task);
      return task;
    });
  }
  list(filter: TaskFilter = {}): readonly Task[] {
    return this.db
      .prepare<Record<string, unknown>, (string | number)[]>('SELECT data FROM tasks ORDER BY id')
      .all()
      .map((row) => decode(row.data))
      .filter(
        (task) =>
          (filter.kind === undefined || task.kind === filter.kind) &&
          (filter.status === undefined || task.status === filter.status) &&
          (filter.owner === undefined || task.owner === filter.owner),
      );
  }
  history(id: string): readonly TaskHistory[] {
    this.get(id);
    return this.db
      .prepare<Record<string, unknown>, (string | number)[]>(
        'SELECT data FROM task_history WHERE task_id = ? ORDER BY version',
      )
      .all(id)
      .map((row) => {
        const task = decode(row.data);
        return { version: task.version, status: task.status, at: task.updatedAt, task };
      });
  }
  close(): void {
    this.db.close();
  }
  addComment(id: string, comment: TaskComment): void {
    for (const value of [comment.id, comment.body, comment.actor, comment.createdAt]) {
      if (!value.trim()) throw new Error('Comment fields must not be empty');
    }
    this.transaction(() => {
      this.get(id);
      this.db
        .prepare<Record<string, unknown>, (string | number)[]>(
          'INSERT INTO task_comments (task_id, id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, comment.id, comment.body, comment.actor, comment.createdAt);
    });
  }
  comments(id: string): readonly TaskComment[] {
    this.get(id);
    return this.db
      .prepare<Record<string, unknown>, (string | number)[]>(
        'SELECT id, body, actor, created_at FROM task_comments WHERE task_id = ? ORDER BY rowid',
      )
      .all(id)
      .map((row) => ({
        id: text(row.id),
        body: text(row.body),
        actor: text(row.actor),
        createdAt: text(row.created_at),
      }));
  }
  linkArtifact(id: string, artifact: TaskArtifact, direction: 'input' | 'output'): Task {
    return this.transaction(() => {
      const task = attachArtifact(this.get(id), artifact, direction);
      this.db
        .prepare<Record<string, unknown>, (string | number)[]>(
          'INSERT INTO task_artifacts (task_id, id, uri, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(id, artifact.id, artifact.uri, artifact.createdAt);
      this.db
        .prepare<Record<string, unknown>, (string | number)[]>(
          'UPDATE tasks SET version = ?, data = ? WHERE id = ?',
        )
        .run(task.version, JSON.stringify(task), id);
      this.append(task);
      return task;
    });
  }
  artifacts(id: string): readonly TaskArtifact[] {
    this.get(id);
    return this.db
      .prepare<Record<string, unknown>, (string | number)[]>(
        'SELECT id, uri, created_at FROM task_artifacts WHERE task_id = ? ORDER BY rowid',
      )
      .all(id)
      .map((row) => ({ id: text(row.id), uri: text(row.uri), createdAt: text(row.created_at) }));
  }
}
