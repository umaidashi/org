import { SqliteSessionStore } from '../sessions/sqlite.js';
import { SqliteMemoryProvider } from '../memory/sqlite.js';
import {
  requestTaskWorkflowApproval,
  type TaskWorkflowApprovalInput,
} from '../workflows/task-approval.js';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApprovalRequest } from './domain.js';
import type { ApprovalRequestInput, ApprovalDecisionInput } from './domain.js';
import { SqliteApprovalStore } from './sqlite.js';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
import { SqliteEventBus } from '../events/sqlite.js';
import { validateCapabilities, validatePermissions } from '../agents/domain.js';
import { applyPermissionApproval } from './service.js';
import { collectAudit } from '../audit/service.js';
import { selectAuditLogs, type LogFilter } from '../audit/logs.js';
export type ApprovalCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'request'; readonly input: ApprovalRequestInput }
  | { readonly action: 'request-task-workflow'; readonly input: TaskWorkflowApprovalInput }
  | { readonly action: 'get'; readonly id: string }
  | { readonly action: 'list' | 'audit' }
  | { readonly action: 'logs'; readonly filter: LogFilter }
  | { readonly action: 'decide'; readonly id: string; readonly input: ApprovalDecisionInput }
  | { readonly action: 'apply'; readonly id: string; readonly actor: string }
);
function required(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`Missing ${field}`);
  return value;
}
export function parseApprovalCommand(argv: string[]): ApprovalCommand {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      key: { type: 'string' },
      actor: { type: 'string' },
      capability: { type: 'string', multiple: true },
      permissions: { type: 'string' },
      'expected-revision': { type: 'string' },
      decision: { type: 'string' },
      reason: { type: 'string' },
      task: { type: 'string' },
      event: { type: 'string' },
      host: { type: 'string' },
      'input-digest': { type: 'string' },
      'request-id': { type: 'string' },
      effect: { type: 'string' },
      limit: { type: 'string' },
      room: { type: 'string' },
      message: { type: 'string' },
      'expected-version': { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (extra.length || !['approval', 'audit', 'logs'].includes(noun ?? ''))
    throw new Error('Expected approval or audit command');
  const db = required(
      parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'),
      '--db',
    ),
    base = { db, json: parsed.values.json ?? false };
  const allowed =
    noun === 'logs'
      ? ['task', 'event', 'limit']
      : action === 'request-task-workflow'
        ? ['room', 'message', 'expected-version', 'host', 'effect']
        : noun === 'audit'
          ? []
          : action === 'request-workflow'
            ? ['key', 'actor', 'host', 'input-digest', 'request-id', 'effect', 'task', 'event']
            : action === 'request'
              ? ['key', 'actor', 'capability', 'permissions', 'expected-revision', 'task', 'event']
              : action === 'decide'
                ? ['actor', 'decision', 'reason']
                : action === 'apply'
                  ? ['actor']
                  : [];
  for (const key of Object.keys(parsed.values))
    if (!['db', 'json', ...allowed].includes(key)) throw new Error(`Unexpected --${key}`);
  if (noun === 'logs') {
    if (
      (action !== undefined && action !== 'tail') ||
      (action === undefined && target !== undefined)
    )
      throw new Error('Unexpected logs argument');
    const value = parsed.values.limit ?? '100';
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Invalid --limit');
    const filter: LogFilter = {
      ...(action === 'tail' ? { agentId: required(target, 'Agent ID') } : {}),
      limit: Number(value),
      ...(parsed.values.task === undefined
        ? {}
        : { taskId: required(parsed.values.task, '--task') }),
      ...(parsed.values.event === undefined
        ? {}
        : { eventId: required(parsed.values.event, '--event') }),
    };
    selectAuditLogs([], filter);
    return { ...base, action: 'logs', filter };
  }
  if (noun === 'audit') {
    if (action !== 'list' || target !== undefined) throw new Error('Expected audit list');
    return { ...base, action: 'audit' };
  }
  if (action === 'list') {
    if (target !== undefined) throw new Error('Unexpected Approval argument');
    return { ...base, action };
  }
  const id = required(target, 'ID');
  if (action === 'request-task-workflow') {
    const effect = parsed.values.effect;
    if (effect !== 'write' && effect !== 'irreversible') throw new Error('Invalid Workflow effect');
    const version = required(parsed.values['expected-version'], '--expected-version');
    if (!/^(0|[1-9][0-9]*)$/.test(version)) throw new Error('Invalid Task version');
    const input: TaskWorkflowApprovalInput = {
      taskId: id,
      roomId: required(parsed.values.room, '--room'),
      messageId: required(parsed.values.message, '--message'),
      expectedVersion: Number(version),
      host: required(parsed.values.host, '--host'),
      effect,
    };
    createApprovalRequest(
      {
        key: 'validate',
        actor: { kind: 'agent', id: 'validate' },
        taskId: id,
        eventId: null,
        operation: {
          kind: 'workflow_invocation',
          host: input.host,
          workflowId: 'validate',
          inputDigest: '0'.repeat(64),
          requestId: 'validate',
          effect,
          binding: {
            taskVersion: input.expectedVersion,
            proposalRef: `org://rooms/${encodeURIComponent(input.roomId)}/messages/${encodeURIComponent(input.messageId)}`,
          },
        },
      },
      { id: 'validate', createdAt: 'validate' },
    );
    return { ...base, action, input };
  }
  if (action === 'request-workflow') {
    const effect = required(parsed.values.effect, '--effect');
    if (effect !== 'write' && effect !== 'irreversible')
      throw new Error('Invalid Workflow Approval effect');
    const input: ApprovalRequestInput = {
      key: required(parsed.values.key, '--key'),
      actor: { kind: 'human', id: required(parsed.values.actor, '--actor') },
      taskId: parsed.values.task ?? null,
      eventId: parsed.values.event ?? null,
      operation: {
        kind: 'workflow_invocation',
        workflowId: id,
        host: required(parsed.values.host, '--host'),
        inputDigest: required(parsed.values['input-digest'], '--input-digest'),
        requestId: required(parsed.values['request-id'], '--request-id'),
        effect,
      },
    };
    createApprovalRequest(input, { id: 'validate', createdAt: 'validate' });
    return { ...base, action: 'request', input };
  }
  if (action === 'request') {
    const input: ApprovalRequestInput = {
      key: required(parsed.values.key, '--key'),
      actor: { kind: 'human', id: required(parsed.values.actor, '--actor') },
      taskId: parsed.values.task ?? null,
      eventId: parsed.values.event ?? null,
      operation: {
        kind: 'agent_capabilities',
        agentId: id,
        expectedRevision: Number(
          required(parsed.values['expected-revision'], '--expected-revision'),
        ),
        capabilities: validateCapabilities(parsed.values.capability ?? []),
        ...(parsed.values.permissions === undefined
          ? {}
          : { permissions: validatePermissions(JSON.parse(parsed.values.permissions)) }),
      },
    };
    createApprovalRequest(input, { id: 'validate', createdAt: 'validate' });
    return { ...base, action, input };
  }
  if (action === 'get') return { ...base, action, id };
  if (action === 'apply')
    return { ...base, action, id, actor: required(parsed.values.actor, '--actor') };
  if (action === 'decide') {
    const decision = required(parsed.values.decision, '--decision');
    if (decision !== 'approve' && decision !== 'reject')
      throw new Error('Invalid Approval decision');
    return {
      ...base,
      action,
      id,
      input: {
        actor: { kind: 'human', id: required(parsed.values.actor, '--actor') },
        decision,
        reason: required(parsed.values.reason, '--reason'),
      },
    };
  }
  throw new Error('Expected approval request|get|list|decide|apply');
}
export function runApprovalCommand(command: ApprovalCommand, output: (line: string) => void): void {
  const store = new SqliteApprovalStore(command.db);
  let agents: SqliteAgentRepository | undefined;
  try {
    let result: unknown;
    switch (command.action) {
      case 'request-task-workflow': {
        agents = new SqliteAgentRepository(command.db);
        const tasks = new SqliteTaskProvider(command.db);
        try {
          const rooms = new SqliteRoomRepository(command.db);
          try {
            result = requestTaskWorkflowApproval(tasks, agents, rooms, store, command.input, {
              id: randomUUID(),
              createdAt: new Date().toISOString(),
            });
          } finally {
            rooms.close();
          }
        } finally {
          tasks.close();
        }
        break;
      }
      case 'request': {
        if (command.input.operation.kind === 'agent_capabilities') {
          agents = new SqliteAgentRepository(command.db);
          agents.capabilitySnapshot(command.input.operation.agentId);
        }
        if (command.input.taskId !== null) {
          const tasks = new SqliteTaskProvider(command.db);
          try {
            tasks.get(command.input.taskId);
          } finally {
            tasks.close();
          }
        }
        if (command.input.eventId !== null) {
          const events = new SqliteEventBus(command.db);
          try {
            events.get(command.input.eventId);
          } finally {
            events.close();
          }
        }
        result = store.requestOnce(
          createApprovalRequest(command.input, {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          }),
        );
        break;
      }
      case 'get':
        result = store.get(command.id);
        break;
      case 'list':
        result = store.list();
        break;
      case 'decide':
        result = store.decide(command.id, command.input, new Date().toISOString());
        break;
      case 'apply':
        agents = new SqliteAgentRepository(command.db);
        result = applyPermissionApproval(
          store,
          agents,
          command.id,
          { kind: 'human', id: command.actor },
          new Date().toISOString(),
        );
        break;
      case 'logs':
      case 'audit': {
        agents = new SqliteAgentRepository(command.db);
        if (
          command.action === 'logs' &&
          command.filter.agentId !== undefined &&
          !agents.list().some((agent) => agent.id === command.filter.agentId)
        )
          throw new Error('Agent not found');
        const tasks = new SqliteTaskProvider(command.db);
        try {
          const events = new SqliteEventBus(command.db);
          try {
            const memories = new SqliteMemoryProvider(command.db);
            try {
              const sessions = new SqliteSessionStore(command.db);
              try {
                const rooms = new SqliteRoomRepository(command.db);
                try {
                  const records = collectAudit(
                    store,
                    agents,
                    tasks,
                    events,
                    memories,
                    sessions,
                    rooms,
                  );
                  result =
                    command.action === 'logs' ? selectAuditLogs(records, command.filter) : records;
                } finally {
                  rooms.close();
                }
              } finally {
                sessions.close();
              }
            } finally {
              memories.close();
            }
          } finally {
            events.close();
          }
        } finally {
          tasks.close();
        }
        break;
      }
    }
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    agents?.close();
    store.close();
  }
}
