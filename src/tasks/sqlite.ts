import type { AuditActor, AuditEntry } from '../audit/domain.js';
import type { TaskOperationContext, TaskOperationReader } from './port.js';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { planTaskReview } from './review.js';
import type { TaskReview, TaskReviewWriter } from './review.js';
import {
  attachArtifact,
  validateTaskComment,
  changeTask,
  isTaskStatus,
  validateTaskReferences,
  mergeWorkItemSnapshot,
} from './domain.js';
import type { Task, TaskPatch, TaskArtifact, TaskComment, WorkItem } from './domain.js';
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
export class SqliteTaskProvider
  implements TaskProvider, IdempotentTaskWriter, TaskReviewWriter, TaskOperationReader
{
  private readonly db: Database;
  constructor(
    path: string,
    private readonly auditActor: AuditActor = { kind: 'system', id: 'unspecified' },
    private readonly auditNow: () => string = () => new Date().toISOString(),
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA busy_timeout = 5000');
    try {
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS task_operation_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_history (task_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(task_id, version));
        CREATE TABLE IF NOT EXISTS task_comments (task_id TEXT NOT NULL, id TEXT PRIMARY KEY, body TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_artifacts (task_id TEXT NOT NULL, id TEXT NOT NULL, uri TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(task_id, id));
        CREATE TABLE IF NOT EXISTS task_reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, task_version INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(task_id, task_version));
        CREATE TRIGGER IF NOT EXISTS task_history_no_update BEFORE UPDATE ON task_history BEGIN SELECT RAISE(ABORT, 'Task history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS task_history_no_delete BEFORE DELETE ON task_history BEGIN SELECT RAISE(ABORT, 'Task history is immutable'); END;`);
      for (const [table, key] of [
        ['task_operation_history', 'sequence=NEW.sequence'],
        ['task_history', 'task_id=NEW.task_id AND version=NEW.version'],
        ['task_artifacts', 'task_id=NEW.task_id AND id=NEW.id'],
        ['task_comments', 'id=NEW.id'],
        ['task_reviews', 'id=NEW.id OR (task_id=NEW.task_id AND task_version=NEW.task_version)'],
      ]) {
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
          WHEN EXISTS(SELECT 1 FROM ${table} WHERE rowid=NEW.rowid OR (${key}))
          BEGIN SELECT RAISE(ABORT, 'Task original is immutable'); END;`);
      }
      for (const table of [
        'task_comments',
        'task_artifacts',
        'task_reviews',
        'task_operation_history',
      ]) {
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
  private versionRef(task: Task): string {
    return `org://tasks/${encodeURIComponent(task.id)}/versions/${task.version}`;
  }
  private appendOperation(
    tool: string,
    task: Task,
    inputRef: string,
    outputRef: string,
    context: TaskOperationContext = {},
  ): void {
    const actor = context.actor ?? this.auditActor;
    const at = this.auditNow();
    if (
      !['human', 'agent', 'system'].includes(actor.kind) ||
      !actor.id.trim() ||
      actor.id.includes('\0') ||
      actor.id.length > 128 ||
      !Number.isFinite(new Date(at).getTime()) ||
      new Date(at).toISOString() !== at ||
      (context.eventId !== undefined && (!context.eventId.trim() || context.eventId.includes('\0')))
    )
      throw new Error('Invalid Task Audit actor/timestamp/context');
    const entry: Omit<AuditEntry, 'id'> = {
      actor,
      taskId: task.id,
      eventId: context.eventId ?? null,
      tool,
      inputRef,
      outputRef,
      at,
      result: 'succeeded',
      approvalId: null,
    };
    this.db.query('INSERT INTO task_operation_history(data) VALUES (?)').run(JSON.stringify(entry));
  }
  operationHistory(): readonly AuditEntry[] {
    return this.db
      .query<{ sequence: number; data: string }, []>(
        'SELECT sequence,data FROM task_operation_history ORDER BY sequence',
      )
      .all()
      .map((row) => {
        const id = `task:operation:${String(row.sequence).padStart(16, '0')}`;
        return { ...(JSON.parse(row.data) as Omit<AuditEntry, 'id'>), id, causalId: id };
      });
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
      this.appendOperation('task.create', task, this.versionRef(task), this.versionRef(task));
    });
  }
  importWorkItemOnce(task: Task): Task {
    if (
      task.kind !== 'work_item' ||
      task.status !== 'pending' ||
      task.owner !== null ||
      task.version !== 0 ||
      task.externalRef === null ||
      !task.externalRef.trim()
    )
      throw new Error('Import requires a new externally referenced WorkItem');
    return this.transaction(() => {
      const row = this.db.query('SELECT data FROM tasks WHERE id=?').get(task.id);
      if (row) {
        const original = this.history(task.id)[0]?.task;
        if (
          !original ||
          !isDeepStrictEqual(original, {
            ...task,
            createdAt: original.createdAt,
            updatedAt: original.updatedAt,
          })
        )
          throw new Error('WorkItem import conflict');
        return this.get(task.id);
      }
      this.validateReferences(task);
      this.db
        .query('INSERT INTO tasks(id, version, data) VALUES (?, ?, ?)')
        .run(task.id, task.version, JSON.stringify(task));
      this.append(task);
      this.appendOperation('task.import', task, this.versionRef(task), this.versionRef(task));
      return task;
    });
  }
  createAssignedOnce(task: Task, owner: string, at: string, context?: TaskOperationContext): Task {
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
      this.appendOperation(
        'task.adopt',
        assigned,
        this.versionRef(task),
        this.versionRef(assigned),
        context,
      );
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
      this.appendOperation('task.update', task, this.versionRef(current), this.versionRef(task));
      return task;
    });
  }
  syncWorkItem(
    snapshot: WorkItem,
    expectedVersion: number,
    at: string,
    relations?: Pick<TaskPatch, 'parentId' | 'dependencies'>,
  ): Task {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      throw new Error('Invalid expected version');
    return this.transaction(() => {
      const current = this.get(snapshot.id);
      if (current.version !== expectedVersion) throw new Error('WorkItem version conflict');
      const task = mergeWorkItemSnapshot(current, snapshot, at, relations);
      if (task === current) return current;
      this.validateReferences(task);
      this.db
        .query('UPDATE tasks SET version=?, data=? WHERE id=?')
        .run(task.version, JSON.stringify(task), task.id);
      this.append(task);
      this.appendOperation('task.sync', task, this.versionRef(current), this.versionRef(task));
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
  recordReview(review: TaskReview): Task {
    return this.transaction(() => {
      const current = this.get(review.taskId);
      const planned = planTaskReview(
        current,
        {
          decision: review.decision,
          actor: review.actor,
          reason: review.reason,
          expectedVersion: review.taskVersion,
        },
        { id: review.id, createdAt: review.createdAt },
      );
      if (JSON.stringify(planned.outputArtifacts) !== JSON.stringify(review.outputArtifacts))
        throw new Error('Task review evidence conflict');
      const task = changeTask(
        current,
        { status: review.decision === 'approve' ? 'completed' : 'failed' },
        review.createdAt,
      );
      this.validateReferences(task);
      this.db
        .query('UPDATE tasks SET version=?, data=? WHERE id=?')
        .run(task.version, JSON.stringify(task), task.id);
      this.append(task);
      this.db
        .query('INSERT INTO task_reviews(id,task_id,task_version,data) VALUES(?,?,?,?)')
        .run(planned.id, planned.taskId, planned.taskVersion, JSON.stringify(planned));
      this.appendOperation(
        'task.review',
        task,
        `org://tasks/${encodeURIComponent(task.id)}/reviews/${encodeURIComponent(planned.id)}`,
        this.versionRef(task),
      );
      return task;
    });
  }
  reviews(id: string): readonly TaskReview[] {
    this.get(id);
    return this.db
      .prepare<{ data: string }, [string]>(
        'SELECT data FROM task_reviews WHERE task_id=? ORDER BY rowid',
      )
      .all(id)
      .map((row) => {
        const value: unknown = JSON.parse(row.data);
        if (
          !record(value) ||
          (value.decision !== 'approve' && value.decision !== 'reject') ||
          typeof value.taskVersion !== 'number' ||
          !Number.isSafeInteger(value.taskVersion) ||
          value.taskVersion < 0
        )
          throw new Error('Invalid stored Task review');
        return {
          id: text(value.id),
          taskId: text(value.taskId),
          taskVersion: value.taskVersion,
          decision: value.decision,
          actor: text(value.actor),
          reason: text(value.reason),
          createdAt: text(value.createdAt),
          outputArtifacts: strings(value.outputArtifacts),
        };
      });
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
  addComment(id: string, comment: TaskComment, expectedVersion?: number): void {
    validateTaskComment(comment);
    this.transaction(() => {
      const current = this.get(id);
      if (expectedVersion !== undefined && current.version !== expectedVersion)
        throw new Error('Task version conflict');
      this.db
        .prepare<Record<string, unknown>, (string | number)[]>(
          'INSERT INTO task_comments (task_id, id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, comment.id, comment.body, comment.actor, comment.createdAt);
      this.appendOperation(
        'task.comment',
        current,
        this.versionRef(current),
        `org://tasks/${encodeURIComponent(id)}/comments/${encodeURIComponent(comment.id)}`,
      );
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
  linkArtifact(
    id: string,
    artifact: TaskArtifact,
    direction: 'input' | 'output',
    expectedVersion?: number,
  ): Task {
    return this.transaction(() => {
      const current = this.get(id);
      if (expectedVersion !== undefined && current.version !== expectedVersion)
        throw new Error('Task version conflict');
      const task = attachArtifact(current, artifact, direction);
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
      this.appendOperation(
        'task.artifact.link',
        task,
        this.versionRef(current),
        this.versionRef(task),
      );
      return task;
    });
  }
  stageExecutionResult(id: string, artifact: TaskArtifact, expectedVersion: number): Task {
    return this.transaction(() => {
      const current = this.get(id);
      if (
        current.version !== expectedVersion ||
        current.kind !== 'execution_task' ||
        current.status !== 'running'
      )
        throw new Error('Execution result requires current running ExecutionTask');
      const linked = attachArtifact(current, artifact, 'output');
      const ready = changeTask(linked, { status: 'waiting_approval' }, artifact.createdAt);
      this.validateReferences(ready);
      this.db
        .query('INSERT INTO task_artifacts(task_id,id,uri,created_at) VALUES (?,?,?,?)')
        .run(id, artifact.id, artifact.uri, artifact.createdAt);
      this.db
        .query('UPDATE tasks SET version=?,data=? WHERE id=?')
        .run(ready.version, JSON.stringify(ready), id);
      this.append(linked);
      this.append(ready);
      this.appendOperation(
        'task.result.stage',
        ready,
        this.versionRef(current),
        this.versionRef(ready),
      );
      return ready;
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
