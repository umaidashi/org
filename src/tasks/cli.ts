import {
  requestLinearArtifactApproval,
  applyApprovedLinearArtifact,
  observeApprovedLinearArtifact,
  validateLinearArtifactInput,
  type LinearArtifactInput,
} from '../linear/artifact.js';
import {
  requestLinearUpdateApproval,
  applyApprovedLinearUpdate,
  observeApprovedLinearUpdate,
  validateLinearUpdateInput,
  type LinearUpdateInput,
} from '../linear/update.js';
import {
  requestLinearCommentApproval,
  applyApprovedLinearComment,
  observeApprovedLinearComment,
  linearCommentDigest,
  type LinearCommentInput,
} from '../linear/comment.js';
import { SqliteApprovalStore } from '../approvals/sqlite.js';
import { SqliteEventBus } from '../events/sqlite.js';
import {
  importLinearWorkItem,
  refreshLinearWorkItem,
  syncLinearWorkItem,
  linearWorkItemIssueId,
} from '../linear/import.js';
import {
  readLinearIssue,
  validateLinearIssueId,
  listLinearIssues,
  validateLinearIssueListInput,
} from '../linear/read.js';
import type { LinearIssueListInput } from '../linear/read.js';
import { EnvironmentSecretStore } from '../secrets/environment.js';
import { linearAgentScopes, linearTaskMapping, linearTaskTeam } from '../linear/config.js';
import { linearTaskClient, requestLinearCoreUpdateApproval } from '../linear/provider.js';
import {
  localTaskClient,
  runTaskClient,
  validateTaskWriteContext,
  type TaskClientAction,
} from './client.js';
import { readLinearCoreWorkItem } from '../linear/projection.js';
import { readAgentLinearIssue } from '../linear/agent-read.js';
import {
  requestTaskLinearUpdateApproval,
  executeApprovedTaskLinearUpdate,
  type TaskLinearApprovalInput,
} from '../linear/task-approval.js';
import { readSandboxArtifact } from '../sandbox/artifact.js';
import { randomUUID } from 'node:crypto';
import { reviewTaskResult } from './review.js';
import type { TaskReviewInput } from './review.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import {
  createTask,
  isTaskStatus,
  parseProviderTaskPatch,
  validateTaskComment,
  validateTaskArtifact,
} from './domain.js';
import type {
  TaskComment,
  TaskArtifact,
  TaskInput,
  TaskKind,
  TaskPatch,
  TaskStatus,
} from './domain.js';
import type { TaskFilter, TaskWriteContext } from './port.js';
import { assignTask, readTaskRoomArtifact } from './service.js';
import { SqliteTaskProvider } from './sqlite.js';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { SqliteSessionStore } from '../sessions/sqlite.js';
import { recoverExecutionTaskResult } from './execution.js';
import { parseLinearIssueFields, type LinearIssueFields } from '../linear/fields.js';

type TaskAction =
  | { kind: 'provider-comment'; id: string; comment: TaskComment; context: TaskWriteContext }
  | {
      kind: 'provider-artifact';
      id: string;
      artifact: TaskArtifact;
      direction: 'input' | 'output';
      context: TaskWriteContext & { readonly title?: string };
    }
  | { kind: 'provider-update'; id: string; patch: TaskPatch; context: TaskWriteContext }
  | {
      kind: 'request-core-linear-update';
      input: {
        taskId: string;
        patch: TaskPatch;
        expectedVersion: number;
        actor: string;
        key: string;
      };
    }
  | {
      kind: 'apply-task-linear-update';
      input: { taskId: string; approvalId: string };
    }
  | {
      kind: 'observe-task-linear-update';
      input: { taskId: string; approvalId: string };
    }
  | { kind: 'request-task-linear-update'; input: TaskLinearApprovalInput }
  | {
      kind: 'observe-linear-update';
      input: { readonly taskId: string; readonly actor: string; readonly approvalId: string };
    }
  | { kind: 'request-linear-update'; input: LinearUpdateInput & { readonly key: string } }
  | { kind: 'apply-linear-update'; input: LinearUpdateInput & { readonly approvalId: string } }
  | {
      kind: 'observe-linear-artifact';
      input: {
        readonly taskId: string;
        readonly title: string;
        readonly actor: string;
        readonly approvalId: string;
      };
    }
  | { kind: 'request-linear-artifact'; input: LinearArtifactInput & { readonly key: string } }
  | { kind: 'apply-linear-artifact'; input: LinearArtifactInput & { readonly approvalId: string } }
  | {
      kind: 'observe-linear-comment';
      input: { readonly taskId: string; readonly actor: string; readonly approvalId: string };
    }
  | { kind: 'request-linear-comment'; input: LinearCommentInput & { readonly key: string } }
  | { kind: 'apply-linear-comment'; input: LinearCommentInput & { readonly approvalId: string } }
  | { kind: 'linear-list'; input: LinearIssueListInput }
  | { kind: 'linear-get'; id: string; agentId?: string; mapped?: boolean }
  | { kind: 'import-linear'; id: string }
  | { kind: 'refresh-linear'; id: string; expectedVersion: number }
  | { kind: 'sync-linear'; id: string; expectedVersion: number }
  | { kind: 'review'; id: string; input: TaskReviewInput }
  | { kind: 'observe-workflow'; id: string; expectedVersion: number }
  | { kind: 'resume-workflow'; id: string; approvalId: string; expectedVersion: number }
  | { kind: 'resume-linear-task'; id: string; approvalId: string; expectedVersion: number }
  | { kind: 'observe-linear-task'; id: string; approvalId: string; expectedVersion: number }
  | { kind: 'run'; id: string; sessionId: string; messageId: string }
  | {
      kind: 'recover-result';
      id: string;
      sessionId: string;
      messageId: string;
      expectedVersion: number;
    }
  | { kind: 'create'; input: TaskInput; id?: string; externalRef?: string }
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
  readonly provider?: 'local' | 'linear';
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
      provider: { type: 'string' },
      id: { type: 'string' },
      'external-ref': { type: 'string' },
      objective: { type: 'string' },
      session: { type: 'string' },
      'room-message': { type: 'string' },
      room: { type: 'string' },
      kind: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      fields: { type: 'string' },
      patch: { type: 'string' },
      'core-patch': { type: 'string' },
      'comment-id': { type: 'string' },
      'created-at': { type: 'string' },
      status: { type: 'string' },
      owner: { type: 'string' },
      priority: { type: 'string' },
      parent: { type: 'string' },
      dependency: { type: 'string', multiple: true },
      label: { type: 'string', multiple: true },
      body: { type: 'string' },
      key: { type: 'string' },
      actor: { type: 'string' },
      agent: { type: 'string' },
      mapped: { type: 'boolean' },
      decision: { type: 'string' },
      reason: { type: 'string' },
      'expected-version': { type: 'string' },
      team: { type: 'string' },
      limit: { type: 'string' },
      after: { type: 'string' },
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
    'apply-task-linear-update': ['approval'],
    'observe-task-linear-update': ['approval'],
    'request-task-linear-update': ['room', 'room-message', 'expected-version', 'key'],
    'request-linear-artifact': ['artifact', 'title', 'expected-version', 'actor', 'key'],
    'apply-linear-artifact': ['artifact', 'title', 'expected-version', 'actor', 'approval'],
    'request-linear-update': [
      'title',
      'description',
      'fields',
      'core-patch',
      'expected-version',
      'actor',
      'key',
    ],
    'apply-linear-update': [
      'title',
      'description',
      'fields',
      'core-patch',
      'expected-version',
      'actor',
      'approval',
    ],
    'observe-linear-update': ['actor', 'approval'],
    'observe-linear-artifact': ['title', 'actor', 'approval'],
    'request-linear-comment': ['expected-version', 'actor', 'body', 'key'],
    'apply-linear-comment': ['expected-version', 'actor', 'body', 'approval'],
    'observe-linear-comment': ['actor', 'approval'],
    'linear-list': ['team', 'limit', 'after'],
    'linear-get': ['agent', 'mapped'],
    'import-linear': [],
    'refresh-linear': ['expected-version'],
    'sync-linear': ['expected-version'],
    review: ['actor', 'reason', 'decision', 'expected-version'],
    reviews: [],
    run: ['session', 'room-message'],
    'recover-result': ['session', 'room-message', 'expected-version'],
    'resume-workflow': ['approval', 'expected-version'],
    'observe-workflow': ['expected-version'],
    'resume-linear-task': ['approval', 'expected-version'],
    'observe-linear-task': ['approval', 'expected-version'],
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
  const options =
    values.provider !== undefined && action === 'update'
      ? ['patch', 'expected-version', 'actor', 'approval']
      : values.provider !== undefined && action === 'comment'
        ? ['body', 'actor', 'comment-id', 'created-at', 'expected-version', 'approval']
        : values.provider !== undefined && action === 'artifact'
          ? [
              'artifact',
              'uri',
              'direction',
              'actor',
              'created-at',
              'expected-version',
              'approval',
              'title',
            ]
          : action === undefined
            ? undefined
            : allowed[action];
  if (!options) throw new Error('Expected task create/list/get/assign/update/history');
  if (
    values.provider !== undefined &&
    (!['local', 'linear'].includes(values.provider) ||
      !['create', 'get', 'list', 'update', 'comment', 'artifact'].includes(action ?? ''))
  )
    throw new Error('Provider supports task create/get/list/update/comment/artifact');
  const providerOptions =
    values.provider === undefined
      ? []
      : ['provider', ...(action === 'create' ? ['id', 'external-ref'] : [])];
  if (values.provider === 'linear' && action === 'create') {
    required(values.id, '--id');
    required(values['external-ref'], '--external-ref');
    if (values.kind === 'execution_task')
      throw new Error('Linear provider supports WorkItems only');
  }
  for (const option of Object.keys(values)) {
    if (!['db', 'json', ...options, ...providerOptions].includes(option))
      throw new Error(`Unexpected --${option} for task ${action}`);
  }
  const db = values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim()) throw new Error('The database path must not be empty');
  const common: Omit<TaskCommand, 'action'> = {
    db,
    json: values.json ?? false,
    ...(values.provider === 'local' || values.provider === 'linear'
      ? { provider: values.provider }
      : {}),
  };
  const corePatch = (value: string | undefined): TaskPatch => {
    try {
      return parseProviderTaskPatch(JSON.parse(required(value, 'Core patch JSON')));
    } catch {
      throw new Error('Invalid Core Task patch');
    }
  };
  const writeContext = (): TaskWriteContext => {
    const context = {
      actor: required(values.actor, '--actor'),
      expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      ...(values.approval === undefined
        ? {}
        : { approvalId: required(values.approval, '--approval') }),
    };
    validateTaskWriteContext(context);
    return context;
  };
  if (values.provider !== undefined && (action === 'comment' || action === 'artifact')) {
    const context = writeContext();
    const createdAt = required(values['created-at'], '--created-at');
    const taskId = required(id, 'Task ID');
    if (action === 'comment') {
      const comment = {
        id: required(values['comment-id'], '--comment-id'),
        body: required(values.body, '--body'),
        actor: context.actor,
        createdAt,
      };
      validateTaskComment(comment);
      return {
        ...common,
        action: {
          kind: 'provider-comment',
          id: taskId,
          comment,
          context,
        },
      };
    }
    if (values.direction !== 'input' && values.direction !== 'output')
      throw new Error('Invalid artifact direction');
    const artifact = {
      id: required(values.artifact, '--artifact'),
      uri: required(values.uri, '--uri'),
      createdAt,
    };
    validateTaskArtifact(artifact);
    return {
      ...common,
      action: {
        kind: 'provider-artifact',
        id: taskId,
        artifact,
        direction: values.direction,
        context: {
          ...context,
          ...(values.title === undefined ? {} : { title: required(values.title, '--title') }),
        },
      },
    };
  }
  if (values.provider !== undefined && action === 'update')
    return {
      ...common,
      action: {
        kind: 'provider-update',
        id: required(id, 'Task ID'),
        patch: corePatch(values.patch),
        context: writeContext(),
      },
    };
  if (
    (action === 'request-linear-update' || action === 'apply-linear-update') &&
    values['core-patch'] !== undefined
  ) {
    if (
      values.fields !== undefined ||
      values.title !== undefined ||
      values.description !== undefined
    )
      throw new Error('Core patch and external fields/content are exclusive');
    const patch = corePatch(values['core-patch']),
      context = writeContext(),
      taskId = required(id, 'WorkItem ID');
    linearWorkItemIssueId(taskId);
    if (action === 'apply-linear-update')
      return {
        ...common,
        provider: 'linear',
        action: {
          kind: 'provider-update',
          id: taskId,
          patch,
          context: { ...context, approvalId: required(values.approval, '--approval') },
        },
      };
    return {
      ...common,
      action: {
        kind: 'request-core-linear-update',
        input: {
          taskId,
          patch,
          expectedVersion: context.expectedVersion,
          actor: context.actor,
          key: required(values.key, '--key'),
        },
      },
    };
  }
  if (action === 'apply-task-linear-update' || action === 'observe-task-linear-update')
    return {
      ...common,
      action: {
        kind: action,
        input: {
          taskId: required(id, 'Execution Task ID'),
          approvalId: required(values.approval, '--approval'),
        },
      },
    };
  if (action === 'request-task-linear-update') {
    const version = required(values['expected-version'], '--expected-version');
    if (!/^(0|[1-9][0-9]*)$/.test(version) || !Number.isSafeInteger(Number(version)))
      throw new Error('Invalid Task version');
    return {
      ...common,
      action: {
        kind: action,
        input: {
          taskId: required(id, 'Execution Task ID'),
          expectedVersion: Number(version),
          roomId: required(values.room, '--room'),
          messageId: required(values['room-message'], '--room-message'),
          key: required(values.key, '--key'),
        },
      },
    };
  }
  if (action === 'request-linear-update' || action === 'apply-linear-update') {
    if (
      values.fields !== undefined &&
      (values.title !== undefined || values.description !== undefined)
    )
      throw new Error('Use either --fields or --title/--description');
    if (values.fields === undefined && values.description === undefined)
      throw new Error('Expected --description');
    let fields: LinearIssueFields | undefined;
    if (values.fields !== undefined) {
      try {
        fields = parseLinearIssueFields(JSON.parse(values.fields));
      } catch {
        throw new Error('Invalid --fields JSON or values');
      }
    }
    const input: LinearUpdateInput = {
      taskId: required(id, 'WorkItem ID'),
      ...(fields === undefined
        ? {
            title: required(values.title, '--title'),
            description: values.description ?? '',
          }
        : { fields }),
      expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      actor: required(values.actor, '--actor'),
    };
    validateLinearUpdateInput(input);
    return {
      ...common,
      action:
        action === 'request-linear-update'
          ? { kind: action, input: { ...input, key: required(values.key, '--key') } }
          : {
              kind: action,
              input: { ...input, approvalId: required(values.approval, '--approval') },
            },
    };
  }
  if (action === 'request-linear-artifact' || action === 'apply-linear-artifact') {
    const input = {
      taskId: required(id, 'WorkItem ID'),
      artifactId: required(values.artifact, '--artifact'),
      title: required(values.title, '--title'),
      expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      actor: required(values.actor, '--actor'),
    };
    validateLinearArtifactInput(input);
    return {
      ...common,
      action:
        action === 'request-linear-artifact'
          ? { kind: action, input: { ...input, key: required(values.key, '--key') } }
          : {
              kind: action,
              input: { ...input, approvalId: required(values.approval, '--approval') },
            },
    };
  }
  if (
    action === 'observe-linear-comment' ||
    action === 'observe-linear-artifact' ||
    action === 'observe-linear-update'
  ) {
    const taskId = required(id, 'WorkItem ID');
    linearWorkItemIssueId(taskId);
    const input = {
      taskId,
      actor: required(values.actor, '--actor'),
      approvalId: required(values.approval, '--approval'),
    };
    return {
      ...common,
      action:
        action === 'observe-linear-artifact'
          ? { kind: action, input: { ...input, title: required(values.title, '--title') } }
          : { kind: action, input },
    };
  }
  if (action === 'request-linear-comment' || action === 'apply-linear-comment') {
    const input = {
      taskId: required(id, 'WorkItem ID'),
      expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      actor: required(values.actor, '--actor'),
      body: required(values.body, '--body'),
    };
    linearWorkItemIssueId(input.taskId);
    linearCommentDigest(input.body);
    return {
      ...common,
      action:
        action === 'request-linear-comment'
          ? { kind: action, input: { ...input, key: required(values.key, '--key') } }
          : {
              kind: action,
              input: { ...input, approvalId: required(values.approval, '--approval') },
            },
    };
  }
  if (action === 'linear-list') {
    if (id !== undefined) throw new Error('Unexpected Linear list argument');
    const input = {
      team: required(values.team, '--team'),
      limit: values.limit === undefined ? 20 : priority(values.limit),
      ...(values.after === undefined ? {} : { after: values.after }),
    };
    validateLinearIssueListInput(input);
    return { ...common, action: { kind: 'linear-list', input } };
  }
  if (action === 'linear-get' && values.agent !== undefined) {
    if (values.mapped) throw new Error('Mapped host read cannot use --agent');
    const issueId = validateLinearIssueId(required(id, 'Issue ID'));
    if (!/^[a-f0-9-]{36}$/.test(issueId)) throw new Error('Agent read requires Issue UUID');
    return {
      ...common,
      action: { kind: 'linear-get', id: issueId, agentId: required(values.agent, '--agent') },
    };
  }
  if (action === 'linear-get' || action === 'import-linear')
    return {
      ...common,
      action: {
        kind: action,
        id: validateLinearIssueId(required(id, 'Issue ID')),
        ...(values.mapped ? { mapped: true } : {}),
      },
    };
  if (action === 'create')
    return {
      ...common,
      action: {
        kind: 'create',
        ...(values.id === undefined ? {} : { id: required(values.id, '--id') }),
        ...(values['external-ref'] === undefined
          ? {}
          : { externalRef: required(values['external-ref'], '--external-ref') }),
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
  if (action === 'refresh-linear' || action === 'sync-linear') {
    linearWorkItemIssueId(taskId);
    return {
      ...common,
      action: {
        kind: action,
        id: taskId,
        expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      },
    };
  }
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
  if (action === 'observe-workflow')
    return {
      ...common,
      action: {
        kind: action,
        id: taskId,
        expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      },
    };
  if (
    action === 'resume-workflow' ||
    action === 'resume-linear-task' ||
    action === 'observe-linear-task'
  )
    return {
      ...common,
      action: {
        kind: action,
        id: taskId,
        approvalId: required(values.approval, '--approval'),
        expectedVersion: priority(required(values['expected-version'], '--expected-version')),
      },
    };
  if (action === 'run' || action === 'recover-result') {
    const result = {
      id: taskId,
      sessionId: required(values.session, '--session'),
      messageId: required(values['room-message'], '--room-message'),
    };
    return {
      ...common,
      action:
        action === 'run'
          ? { kind: action, ...result }
          : {
              kind: action,
              ...result,
              expectedVersion: priority(required(values['expected-version'], '--expected-version')),
            },
    };
  }
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
  if (command.provider !== undefined) {
    const action = command.action;
    if (
      action.kind !== 'create' &&
      action.kind !== 'get' &&
      action.kind !== 'list' &&
      action.kind !== 'provider-update' &&
      action.kind !== 'provider-comment' &&
      action.kind !== 'provider-artifact'
    )
      throw new Error('Provider supports task create/get/list/update/comment/artifact');
    const coreAction: TaskClientAction =
      action.kind === 'provider-comment'
        ? { kind: 'comment', id: action.id, comment: action.comment, context: action.context }
        : action.kind === 'provider-artifact'
          ? {
              kind: 'artifact',
              id: action.id,
              artifact: action.artifact,
              direction: action.direction,
              context: action.context,
            }
          : action.kind === 'create'
            ? {
                kind: 'create',
                task: {
                  ...createTask(action.input, {
                    id: action.id ?? randomUUID(),
                    createdAt: new Date().toISOString(),
                  }),
                  externalRef: action.externalRef ?? null,
                },
              }
            : action.kind === 'provider-update'
              ? { kind: 'update', id: action.id, patch: action.patch, context: action.context }
              : action.kind === 'list'
                ? { kind: 'list', filter: action.filter }
                : { kind: 'get', id: action.id };
    const settings =
      command.provider === 'linear'
        ? { mapping: linearTaskMapping(), team: linearTaskTeam() }
        : undefined;
    const store = new SqliteTaskProvider(command.db, { kind: 'system', id: 'local-host' });
    try {
      if (!settings) {
        output(
          JSON.stringify(
            await runTaskClient(
              localTaskClient(store, () => new Date().toISOString()),
              coreAction,
            ),
            null,
            command.json ? undefined : 2,
          ),
        );
        return;
      }
      const agents = new SqliteAgentRepository(command.db);
      try {
        const secrets = new EnvironmentSecretStore(
          ['linear:read', 'linear:write'].map((reference) => ({
            actorId: 'linear:host',
            reference,
            environmentVariable: 'LINEAR_API_KEY',
          })),
        );
        const approvals = new SqliteApprovalStore(command.db);
        try {
          const events = new SqliteEventBus(command.db, { kind: 'system', id: 'local-host' });
          try {
            const provider = linearTaskClient(
              store,
              fetch,
              secrets,
              agents,
              settings.mapping,
              settings.team,
              () => new Date().toISOString(),
              { approvals, events },
            );
            output(
              JSON.stringify(
                await runTaskClient(provider, coreAction),
                null,
                command.json ? undefined : 2,
              ),
            );
          } finally {
            events.close();
          }
        } finally {
          approvals.close();
        }
      } finally {
        agents.close();
      }
    } finally {
      store.close();
    }
    return;
  }
  if (command.action.kind === 'request-core-linear-update') {
    const mapping = linearTaskMapping(),
      team = linearTaskTeam();
    const store = new SqliteTaskProvider(command.db, { kind: 'system', id: 'local-host' });
    try {
      const agents = new SqliteAgentRepository(command.db);
      try {
        const approvals = new SqliteApprovalStore(command.db);
        try {
          const secrets = new EnvironmentSecretStore([
            {
              actorId: 'linear:host',
              reference: 'linear:read',
              environmentVariable: 'LINEAR_API_KEY',
            },
          ]);
          const result = await requestLinearCoreUpdateApproval(
            store,
            approvals,
            fetch,
            secrets,
            agents,
            mapping,
            team,
            command.action.input,
            { id: randomUUID(), createdAt: new Date().toISOString() },
          );
          output(JSON.stringify(result, null, command.json ? undefined : 2));
        } finally {
          approvals.close();
        }
      } finally {
        agents.close();
      }
    } finally {
      store.close();
    }
    return;
  }
  if (
    command.action.kind === 'request-task-linear-update' ||
    command.action.kind === 'apply-task-linear-update' ||
    command.action.kind === 'observe-task-linear-update'
  ) {
    const scopes = linearAgentScopes();
    const secrets = new EnvironmentSecretStore(
      scopes.flatMap((scope) =>
        [
          'linear:read',
          ...(scope.effect === 'write' && command.action.kind === 'apply-task-linear-update'
            ? ['linear:write']
            : []),
        ].map((reference) => ({
          actorId: scope.agentId,
          reference,
          environmentVariable: scope.apiKeyEnv,
        })),
      ),
    );
    const tasks = new SqliteTaskProvider(command.db, { kind: 'system', id: 'local-host' });
    let agents: SqliteAgentRepository | undefined,
      rooms: SqliteRoomRepository | undefined,
      approvals: SqliteApprovalStore | undefined,
      events: SqliteEventBus | undefined;
    try {
      agents = new SqliteAgentRepository(command.db);
      rooms = new SqliteRoomRepository(command.db);
      approvals = new SqliteApprovalStore(command.db);
      let result;
      if (command.action.kind === 'request-task-linear-update')
        result = await requestTaskLinearUpdateApproval(
          tasks,
          agents,
          rooms,
          approvals,
          scopes,
          secrets,
          fetch,
          command.action.input,
          { id: randomUUID(), createdAt: new Date().toISOString() },
        );
      else {
        events = new SqliteEventBus(command.db, { kind: 'system', id: 'local-host' });
        result = await executeApprovedTaskLinearUpdate(
          tasks,
          agents,
          rooms,
          approvals,
          events,
          scopes,
          secrets,
          fetch,
          command.action.input,
          () => new Date().toISOString(),
          command.action.kind === 'apply-task-linear-update' ? 'apply' : 'observe',
        );
      }
      output(JSON.stringify(result, null, command.json ? undefined : 2));
    } finally {
      events?.close();
      approvals?.close();
      rooms?.close();
      agents?.close();
      tasks.close();
    }
    return;
  }
  if (command.action.kind === 'linear-get' && command.action.agentId !== undefined) {
    const scopes = linearAgentScopes();
    const secrets = new EnvironmentSecretStore(
      scopes.map((scope) => ({
        actorId: scope.agentId,
        reference: 'linear:read',
        environmentVariable: scope.apiKeyEnv,
      })),
    );
    const agents = new SqliteAgentRepository(command.db);
    let events: SqliteEventBus | undefined;
    try {
      events = new SqliteEventBus(command.db, { kind: 'system', id: 'local-host' });
      const result = await readAgentLinearIssue(
        agents,
        scopes,
        secrets,
        fetch,
        {
          agentId: command.action.agentId,
          issueId: command.action.id,
        },
        { events, now: () => new Date().toISOString(), id: randomUUID },
      );
      output(JSON.stringify(result, null, command.json ? undefined : 2));
    } finally {
      try {
        events?.close();
      } finally {
        agents.close();
      }
    }
    return;
  }
  if (command.action.kind === 'linear-get' || command.action.kind === 'linear-list') {
    const secrets = new EnvironmentSecretStore([
      { actorId: 'linear:host', reference: 'linear:read', environmentVariable: 'LINEAR_API_KEY' },
    ]);
    if (command.action.kind === 'linear-get' && command.action.mapped) {
      const mapping = linearTaskMapping();
      const agents = new SqliteAgentRepository(command.db);
      try {
        output(
          JSON.stringify(
            await readLinearCoreWorkItem(fetch, secrets, agents, mapping, command.action.id),
            null,
            command.json ? undefined : 2,
          ),
        );
      } finally {
        agents.close();
      }
      return;
    }
    const result =
      command.action.kind === 'linear-list'
        ? await listLinearIssues(fetch, secrets, command.action.input)
        : await readLinearIssue(fetch, secrets, command.action.id);
    output(JSON.stringify(result, null, command.json ? undefined : 2));
    return;
  }
  if (command.action.kind === 'sync-linear') {
    const mapping = linearTaskMapping();
    const provider = new SqliteTaskProvider(command.db, { kind: 'system', id: 'local-host' });
    try {
      const agents = new SqliteAgentRepository(command.db);
      try {
        const secrets = new EnvironmentSecretStore([
          {
            actorId: 'linear:host',
            reference: 'linear:read',
            environmentVariable: 'LINEAR_API_KEY',
          },
        ]);
        const id = command.action.id;
        const result = await syncLinearWorkItem(
          provider,
          () => readLinearCoreWorkItem(fetch, secrets, agents, mapping, linearWorkItemIssueId(id)),
          id,
          command.action.expectedVersion,
          () => new Date().toISOString(),
        );
        output(JSON.stringify(result, null, command.json ? undefined : 2));
      } finally {
        agents.close();
      }
    } finally {
      provider.close();
    }
    return;
  }
  if (command.action.kind === 'import-linear' || command.action.kind === 'refresh-linear') {
    const secrets = new EnvironmentSecretStore([
      { actorId: 'linear:host', reference: 'linear:read', environmentVariable: 'LINEAR_API_KEY' },
    ]);
    const id = command.action.id;
    const provider = new SqliteTaskProvider(command.db, { kind: 'system', id: 'local-host' });
    try {
      const result =
        command.action.kind === 'refresh-linear'
          ? await refreshLinearWorkItem(
              provider,
              () => readLinearIssue(fetch, secrets, linearWorkItemIssueId(id)),
              id,
              command.action.expectedVersion,
              new Date().toISOString(),
            )
          : await importLinearWorkItem(
              provider,
              () => readLinearIssue(fetch, secrets, id),
              new Date().toISOString(),
            );
      output(JSON.stringify(result, null, command.json ? undefined : 2));
    } finally {
      provider.close();
    }
    return;
  }
  if (
    command.action.kind === 'provider-update' ||
    command.action.kind === 'provider-comment' ||
    command.action.kind === 'provider-artifact'
  )
    throw new Error('Core update requires provider');
  const provider = new SqliteTaskProvider(command.db, { kind: 'system', id: 'local-host' });
  try {
    const action = command.action;
    let result: unknown;
    switch (action.kind) {
      case 'request-linear-artifact':
      case 'request-linear-update':
      case 'apply-linear-update':
      case 'apply-linear-artifact':
      case 'observe-linear-comment':
      case 'observe-linear-artifact':
      case 'observe-linear-update':
      case 'request-linear-comment':
      case 'apply-linear-comment': {
        const approvals = new SqliteApprovalStore(command.db);
        try {
          if (action.kind === 'request-linear-comment')
            result = requestLinearCommentApproval(provider, approvals, action.input, {
              id: randomUUID(),
              createdAt: new Date().toISOString(),
            });
          else if (action.kind === 'request-linear-artifact')
            result = requestLinearArtifactApproval(provider, approvals, action.input, {
              id: randomUUID(),
              createdAt: new Date().toISOString(),
            });
          else {
            const events = new SqliteEventBus(command.db, { kind: 'system', id: 'local-host' });
            try {
              const references =
                action.kind === 'request-linear-update' || action.kind === 'apply-linear-update'
                  ? ['linear:read', 'linear:write']
                  : [
                      action.kind === 'observe-linear-comment' ||
                      action.kind === 'observe-linear-artifact' ||
                      action.kind === 'observe-linear-update'
                        ? 'linear:read'
                        : 'linear:write',
                    ];
              const secrets = new EnvironmentSecretStore(
                references.map((reference) => ({
                  actorId: 'linear:host',
                  reference,
                  environmentVariable: 'LINEAR_API_KEY',
                })),
              );
              result =
                action.kind === 'request-linear-update'
                  ? await requestLinearUpdateApproval(
                      provider,
                      approvals,
                      secrets,
                      fetch,
                      action.input,
                      { id: randomUUID(), createdAt: new Date().toISOString() },
                    )
                  : action.kind === 'apply-linear-update'
                    ? await applyApprovedLinearUpdate(
                        provider,
                        approvals,
                        events,
                        secrets,
                        fetch,
                        action.input,
                        () => new Date().toISOString(),
                      )
                    : action.kind === 'observe-linear-update'
                      ? await observeApprovedLinearUpdate(
                          provider,
                          approvals,
                          events,
                          secrets,
                          fetch,
                          action.input,
                          () => new Date().toISOString(),
                        )
                      : action.kind === 'observe-linear-artifact'
                        ? await observeApprovedLinearArtifact(
                            provider,
                            approvals,
                            events,
                            secrets,
                            fetch,
                            action.input,
                            () => new Date().toISOString(),
                          )
                        : action.kind === 'observe-linear-comment'
                          ? await observeApprovedLinearComment(
                              provider,
                              approvals,
                              events,
                              secrets,
                              fetch,
                              action.input,
                              () => new Date().toISOString(),
                            )
                          : action.kind === 'apply-linear-artifact'
                            ? await applyApprovedLinearArtifact(
                                provider,
                                approvals,
                                events,
                                secrets,
                                fetch,
                                action.input,
                                () => new Date().toISOString(),
                              )
                            : await applyApprovedLinearComment(
                                provider,
                                approvals,
                                events,
                                secrets,
                                fetch,
                                action.input,
                                () => new Date().toISOString(),
                              );
            } finally {
              events.close();
            }
          }
        } finally {
          approvals.close();
        }
        break;
      }

      case 'recover-result': {
        const rooms = new SqliteRoomRepository(command.db);
        try {
          const sessions = new SqliteSessionStore(command.db);
          try {
            result = recoverExecutionTaskResult(
              provider,
              sessions,
              rooms,
              {
                taskId: action.id,
                sessionId: action.sessionId,
                messageId: action.messageId,
                expectedVersion: action.expectedVersion,
              },
              () => new Date().toISOString(),
            );
          } finally {
            sessions.close();
          }
        } finally {
          rooms.close();
        }
        break;
      }
      case 'review':
        result = reviewTaskResult(provider, action.id, action.input, {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });
        break;
      case 'reviews':
        result = provider.reviews(action.id);
        break;
      case 'observe-workflow':
      case 'resume-workflow':
        throw new Error('Workflow resume requires daemon');
      case 'resume-linear-task':
      case 'observe-linear-task':
        throw new Error('Linear Task resume or observation requires daemon');
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
        let content: string;
        if (artifact.uri.startsWith('org://rooms/')) {
          const rooms = new SqliteRoomRepository(command.db);
          try {
            content = readTaskRoomArtifact(rooms, action.id, artifact.uri);
          } finally {
            rooms.close();
          }
        } else content = await readSandboxArtifact(command.db + '.artifacts', artifact.uri);
        result = {
          ...artifact,
          content,
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
