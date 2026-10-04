import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { createTask, isTaskStatus } from './domain.js';
import type { TaskInput, TaskKind, TaskPatch, TaskStatus } from './domain.js';
import type { TaskFilter } from './port.js';
import { assignTask } from './service.js';
import { SqliteTaskProvider } from './sqlite.js';

type TaskAction =
  | { kind: 'create'; input: TaskInput }
  | { kind: 'get' | 'history' | 'comments' | 'artifacts'; id: string }
  | { kind: 'comment'; id: string; body: string; actor: string }
  | { kind: 'artifact'; id: string; artifact: string; uri: string; direction: 'input' | 'output' }
  | { kind: 'list'; filter: TaskFilter }
  | { kind: 'assign'; id: string; owner: string }
  | { kind: 'update'; id: string; patch: TaskPatch };
export interface TaskCommand {
  readonly db: string;
  readonly json: boolean;
  readonly action: TaskAction;
}
function required(value: string | undefined, label: string): string {
  if (value === undefined || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}
function taskKind(value: string): TaskKind {
  if (value !== 'work_item' && value !== 'execution_task') throw new Error('Invalid task kind');
  return value;
}
function status(value: string): TaskStatus {
  if (!isTaskStatus(value)) throw new Error('Invalid task status');
  return value;
}
function priority(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Priority must be a nonnegative integer');
  return Number(value);
}
export function parseTaskCommand(argv: string[]): TaskCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      objective: { type: 'string' },
      kind: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
      owner: { type: 'string' },
      priority: { type: 'string' },
      parent: { type: 'string' },
      dependency: { type: 'string', multiple: true },
      label: { type: 'string', multiple: true },
      body: { type: 'string' },
      actor: { type: 'string' },
      artifact: { type: 'string' },
      uri: { type: 'string' },
      direction: { type: 'string' },
    },
  });
  const [command, action, id, ...extra] = positionals;
  if (command !== 'task' || extra.length > 0) throw new Error('Unexpected task argument');
  const allowed: Record<string, readonly string[]> = {
    create: ['objective', 'kind', 'priority', 'parent', 'dependency', 'label'],
    list: ['kind', 'status', 'owner'],
    get: [],
    history: [],
    comments: [],
    artifacts: [],
    comment: ['body', 'actor'],
    artifact: ['artifact', 'uri', 'direction'],
    assign: ['owner'],
    update: ['title', 'objective', 'status', 'priority', 'parent', 'dependency', 'label'],
  };
  const options = action === undefined ? undefined : allowed[action];
  if (!options) throw new Error('Expected task create/list/get/assign/update/history');
  for (const option of Object.keys(values)) {
    if (!['db', 'json', ...options].includes(option))
      throw new Error(`Unexpected --${option} for task ${action}`);
  }
  const db = values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim()) throw new Error('The database path must not be empty');
  const common = { db, json: values.json ?? false };
  if (action === 'create')
    return {
      ...common,
      action: {
        kind: 'create',
        input: {
          title: required(id, 'title'),
          objective: required(values.objective, '--objective'),
          ...(values.kind !== undefined ? { kind: taskKind(values.kind) } : {}),
          ...(values.priority !== undefined ? { priority: priority(values.priority) } : {}),
          ...(values.parent !== undefined ? { parentId: values.parent } : {}),
          ...(values.dependency !== undefined ? { dependencies: values.dependency } : {}),
          ...(values.label !== undefined ? { labels: values.label } : {}),
        },
      },
    };
  if (action === 'list') {
    if (id !== undefined) throw new Error('Unexpected task list argument');
    return {
      ...common,
      action: {
        kind: 'list',
        filter: {
          ...(values.kind !== undefined ? { kind: taskKind(values.kind) } : {}),
          ...(values.status !== undefined ? { status: status(values.status) } : {}),
          ...(values.owner !== undefined ? { owner: values.owner } : {}),
        },
      },
    };
  }
  const taskId = required(id, 'task id');
  if (action === 'get' || action === 'history' || action === 'comments' || action === 'artifacts')
    return { ...common, action: { kind: action, id: taskId } };
  if (action === 'comment')
    return {
      ...common,
      action: {
        kind: 'comment',
        id: taskId,
        body: required(values.body, '--body'),
        actor: required(values.actor, '--actor'),
      },
    };
  if (action === 'artifact') {
    const direction = required(values.direction, '--direction');
    if (direction !== 'input' && direction !== 'output')
      throw new Error('Invalid artifact direction');
    return {
      ...common,
      action: {
        kind: 'artifact',
        id: taskId,
        artifact: required(values.artifact, '--artifact'),
        uri: required(values.uri, '--uri'),
        direction,
      },
    };
  }
  if (action === 'assign')
    return {
      ...common,
      action: { kind: 'assign', id: taskId, owner: required(values.owner, '--owner') },
    };
  const patch: TaskPatch = {
    ...(values.title !== undefined ? { title: values.title } : {}),
    ...(values.objective !== undefined ? { objective: values.objective } : {}),
    ...(values.status !== undefined ? { status: status(values.status) } : {}),
    ...(values.priority !== undefined ? { priority: priority(values.priority) } : {}),
    ...(values.parent !== undefined ? { parentId: values.parent } : {}),
    ...(values.dependency !== undefined ? { dependencies: values.dependency } : {}),
    ...(values.label !== undefined ? { labels: values.label } : {}),
  };
  if (Object.keys(patch).length === 0) throw new Error('Task update requires a patch');
  return { ...common, action: { kind: 'update', id: taskId, patch } };
}
export function runTaskCommand(command: TaskCommand): void {
  const provider = new SqliteTaskProvider(command.db);
  try {
    const action = command.action;
    let result: unknown;
    switch (action.kind) {
      case 'create': {
        const task = createTask(action.input, {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });
        provider.create(task);
        result = task;
        break;
      }
      case 'get':
        result = provider.get(action.id);
        break;
      case 'history':
        result = provider.history(action.id);
        break;
      case 'comments':
        result = provider.comments(action.id);
        break;
      case 'artifacts':
        result = provider.artifacts(action.id);
        break;
      case 'comment': {
        const comment = {
          id: randomUUID(),
          body: action.body,
          actor: action.actor,
          createdAt: new Date().toISOString(),
        };
        provider.addComment(action.id, comment);
        result = comment;
        break;
      }
      case 'artifact':
        result = provider.linkArtifact(
          action.id,
          { id: action.artifact, uri: action.uri, createdAt: new Date().toISOString() },
          action.direction,
        );
        break;
      case 'list':
        result = provider.list(action.filter);
        break;
      case 'update':
        result = provider.update(action.id, action.patch, new Date().toISOString());
        break;
      case 'assign': {
        const agents = new SqliteAgentRepository(command.db);
        try {
          result = assignTask(provider, agents, action.id, action.owner, new Date().toISOString());
        } finally {
          agents.close();
        }
        break;
      }
    }
    console.log(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    provider.close();
  }
}
