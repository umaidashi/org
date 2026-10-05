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
import { validateCapabilities } from '../agents/domain.js';
import { applyPermissionApproval } from './service.js';
import { buildTaskExecutionAudit } from '../audit/tasks.js';
import { buildAudit } from '../audit/domain.js';
export type ApprovalCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'request'; readonly input: ApprovalRequestInput }
  | { readonly action: 'get'; readonly id: string }
  | { readonly action: 'list' | 'audit' }
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
      'expected-revision': { type: 'string' },
      decision: { type: 'string' },
      reason: { type: 'string' },
      task: { type: 'string' },
      event: { type: 'string' },
      host: { type: 'string' },
      'input-digest': { type: 'string' },
      'request-id': { type: 'string' },
      effect: { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (extra.length || !['approval', 'audit'].includes(noun ?? ''))
    throw new Error('Expected approval or audit command');
  const db = required(
      parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'),
      '--db',
    ),
    base = { db, json: parsed.values.json ?? false };
  const allowed =
    noun === 'audit'
      ? []
      : action === 'request-workflow'
        ? ['key', 'actor', 'host', 'input-digest', 'request-id', 'effect', 'task', 'event']
        : action === 'request'
          ? ['key', 'actor', 'capability', 'expected-revision', 'task', 'event']
          : action === 'decide'
            ? ['actor', 'decision', 'reason']
            : action === 'apply'
              ? ['actor']
              : [];
  for (const key of Object.keys(parsed.values))
    if (!['db', 'json', ...allowed].includes(key)) throw new Error(`Unexpected --${key}`);
  if (noun === 'audit') {
    if (action !== 'list' || target !== undefined) throw new Error('Expected audit list');
    return { ...base, action: 'audit' };
  }
  if (action === 'list') {
    if (target !== undefined) throw new Error('Unexpected Approval argument');
    return { ...base, action };
  }
  const id = required(target, 'ID');
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
      case 'audit': {
        agents = new SqliteAgentRepository(command.db);
        const tasks = new SqliteTaskProvider(command.db);
        try {
          result = buildAudit(
            store.list(),
            agents.capabilityHistory(),
            tasks.list().flatMap((task) => buildTaskExecutionAudit(tasks.history(task.id))),
          );
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
