import { readSandboxArtifact } from '../sandbox/artifact.js';
import { randomUUID } from 'node:crypto';
import { reviewTaskResult } from './review.js';
import type { TaskReviewInput } from './review.js';
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
  | { kind: 'review'; id: string; input: TaskReviewInput }
  | { kind: 'resume-workflow'; id: string; approvalId: string; expectedVersion: number }
  | { kind: 'run'; id: string; sessionId: string; messageId: string }
  | { kind: 'create'; input: TaskInput }
  | { kind: 'get' | 'history' | 'comments' | 'artifacts' | 'reviews'; id: string }
  | { kind: 'comment'; id: string; body: string; actor: string }
  | { kind: 'artifact-content'; id: string; artifact: string }
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
      session: { type: 'string' },
      'room-message': { type: 'string' },
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
      decision: { type: 'string' },
      reason: { type: 'string' },
      'expected-version': { type: 'string' },
      artifact: { type: 'string' },
      uri: { type: 'string' },
      direction: { type: 'string' },
      'clear-dependencies': { type: 'boolean' },
      'clear-labels': { type: 'boolean' },
      approval: { type: 'string' },
      'clear-parent': { type: 'boolean' },
    },
  });
  const [command, action, id, ...extra] = positionals;
  if (command !== 'task' || extra.length > 0) throw new Error('Unexpected task argument');
  const allowed: Record<string, readonly string[]> = {
    review: ['actor', 'reason', 'decision', 'expected-version'],
    reviews: [],
    run: ['session', 'room-message'],
    'resume-workflow': ['approval', 'expected-version'],
    create: ['objective', 'kind', 'priority', 'parent', 'dependency', 'label'],
    list: ['kind', 'status', 'owner'],
    get: [],
    history: [],
    comments: [],
    artifacts: [],
    'artifact-content': ['artifact'],
    comment: ['body', 'actor'],
    artifact: ['artifact', 'uri', 'direction'],
    assign: ['owner'],
    update: [
      'title',
      'objective',
      'status',
      'priority',
      'parent',
      'dependency',
      'label',
      'clear-dependencies',
      'clear-labels',
      'clear-parent',
    ],
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
  if (action === 'review') {
    const decision = required(values.decision, '--decision');
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Invalid review decision');
    const version = required(values['expected-version'], '--expected-version');
    if (!/^\d+$/.test(version) || !Number.isSafeInteger(Number(version)))
      throw new Error('Expected version must be a nonnegative integer');
    return {
      ...common,
      action: {
        kind: 'review',
        id: taskId,
        input: {
          decision,
          actor: required(values.actor, '--actor'),
          reason: required(values.reason, '--reason'),
          expectedVersion: Number(version),
        },
      },
    };
  }
  if (action === 'resume-workflow')
    return {
      ...common,
      action: {
        kind: action,
        id: taskId,
        approvalId: required(values.approval, '--approval'),
        expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      },
    };
  if (action === 'run')
    return {
      ...common,
      action: {
        kind: 'run',
        id: taskId,
        sessionId: required(values.session, '--session'),
        messageId: required(values['room-message'], '--room-message'),
      },
    };
  if (
    action === 'get' ||
    action === 'history' ||
    action === 'comments' ||
    action === 'artifacts' ||
    action === 'reviews'
  )
    return { ...common, action: { kind: action, id: taskId } };
  if (action === 'artifact-content')
    return {
      ...common,
      action: {
        kind: 'artifact-content',
        id: taskId,
        artifact: required(values.artifact, '--artifact'),
      },
    };
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
  if (
    (values['clear-dependencies'] && values.dependency !== undefined) ||
    (values['clear-labels'] && values.label !== undefined) ||
    (values['clear-parent'] && values.parent !== undefined)
  )
    throw new Error('Cannot clear and replace the same field');
  const clearedPatch: TaskPatch = {
    ...patch,
    ...(values['clear-dependencies'] ? { dependencies: [] } : {}),
    ...(values['clear-labels'] ? { labels: [] } : {}),
    ...(values['clear-parent'] ? { parentId: null } : {}),
  };
  if (Object.keys(clearedPatch).length === 0) throw new Error('Task update requires a patch');
  return { ...common, action: { kind: 'update', id: taskId, patch: clearedPatch } };
}
export async function runTaskCommand(
  command: TaskCommand,
  output: (line: string) => void = console.log,
): Promise<void> {
  const provider = new SqliteTaskProvider(command.db);
  try {
    const action = command.action;
    let result: unknown;
    switch (action.kind) {
      case 'review':
        result = reviewTaskResult(provider, action.id, action.input, {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });
        break;
      case 'reviews':
        result = provider.reviews(action.id);
        break;
      case 'resume-workflow':
        throw new Error('Workflow resume requires daemon');
      case 'run':
        throw new Error('Task run requires daemon');
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
      case 'artifact-content': {
        const artifact = provider
          .artifacts(action.id)
          .find((candidate) => candidate.id === action.artifact);
        if (!artifact) throw new Error('Task artifact not found');
        result = {
          ...artifact,
          content: await readSandboxArtifact(command.db + '.artifacts', artifact.uri),
        };
        break;
      }
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
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    provider.close();
  }
}
