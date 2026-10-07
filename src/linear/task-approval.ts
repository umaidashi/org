import { isDeepStrictEqual } from 'node:util';
import type { TaskProvider } from '../tasks/port.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { SecretStore } from '../secrets/port.js';
import type { EventBus } from '../events/port.js';
import { createApprovalRequest, type LinearTaskBinding } from '../approvals/domain.js';
import { requireTaskOwnerMessage } from '../tasks/proposal.js';
import { linearWorkItemIssueId } from './import.js';
import { parseLinearIssueFields } from './fields.js';
import {
  prepareLinearUpdateOperation,
  validateLinearUpdateInput,
  type LinearUpdateInput,
  linearUpdateTarget,
  applyApprovedLinearUpdate,
  observeApprovedLinearUpdate,
} from './update.js';
import { requireApprovedLinearRequest } from './operation.js';
import {
  parseLinearAgentScopes,
  requireAgentLinearScope,
  type LinearAgentScope,
} from './agent-read.js';

export interface TaskLinearApprovalInput {
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly roomId: string;
  readonly messageId: string;
  readonly key: string;
  readonly phase?: 'running';
}
export function resolveTaskLinearProposal(
  tasks: Pick<TaskProvider, 'get'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  configured: readonly LinearAgentScope[],
  source: Omit<TaskLinearApprovalInput, 'key'>,
) {
  if (!Number.isSafeInteger(source.expectedVersion) || source.expectedVersion < 0)
    throw new Error('Invalid Task version');
  const task = tasks.get(source.taskId),
    room = rooms.get(source.roomId);
  if (
    task.id !== source.taskId ||
    task.version !== source.expectedVersion ||
    room.id !== source.roomId
  )
    throw new Error('Task proposal source mismatch');
  const message = rooms.messages(room.id).find((m) => m.id === source.messageId);
  if (!message) throw new Error('Task proposal Message not found');
  requireTaskOwnerMessage(
    task,
    room,
    message,
    source.phase === 'running' ? task.version : undefined,
  );
  if (!task.parentId || !task.owner) throw new Error('Linear proposal requires parent WorkItem');
  const issueId = linearWorkItemIssueId(task.parentId);
  requireAgentLinearScope(agents, configured, { agentId: task.owner, issueId, effect: 'write' });
  const update = parseTaskLinearProposal(message.content, task.parentId, task.owner);
  const binding: LinearTaskBinding = {
    taskId: task.id,
    taskVersion: task.version,
    proposalRef: `org://rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(message.id)}`,
  };
  return { update, binding };
}
export function parseTaskLinearProposal(
  content: string,
  taskId: string,
  actor: string,
): LinearUpdateInput {
  try {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 65536) throw new Error('Size');
    const value: unknown = JSON.parse(content);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          !['version', 'tool', 'workItemVersion', 'title', 'description', 'fields'].includes(key),
      ) ||
      !('version' in value) ||
      value.version !== 1 ||
      !('tool' in value) ||
      value.tool !== 'linear-update' ||
      !('workItemVersion' in value) ||
      typeof value.workItemVersion !== 'number'
    )
      throw new Error('Fields');
    const base = { taskId, actor, expectedVersion: value.workItemVersion };
    let input: LinearUpdateInput;
    if ('fields' in value) {
      if ('title' in value || 'description' in value) throw new Error('Mixed modes');
      input = { ...base, fields: parseLinearIssueFields(value.fields) };
    } else {
      if (
        !('title' in value) ||
        typeof value.title !== 'string' ||
        !('description' in value) ||
        typeof value.description !== 'string'
      )
        throw new Error('Content');
      input = { ...base, title: value.title, description: value.description };
    }
    validateLinearUpdateInput(input);
    return input;
  } catch {
    throw new Error('Invalid Task Linear update proposal');
  }
}
export async function requestTaskLinearUpdateApproval(
  tasks: Pick<TaskProvider, 'get'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  approvals: Pick<ApprovalStore, 'requestOnce'>,
  scopes: readonly LinearAgentScope[],
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: TaskLinearApprovalInput,
  identity: { readonly id: string; readonly createdAt: string },
) {
  const source = { ...input },
    configured = parseLinearAgentScopes(scopes);
  const resolve = () => resolveTaskLinearProposal(tasks, agents, rooms, configured, source);
  const original = resolve();
  const authorize = () => {
    if (!isDeepStrictEqual(resolve(), original)) throw new Error('Task Linear proposal changed');
  };
  const operation = await prepareLinearUpdateOperation(
    tasks,
    {
      getSecret: (actor, reference) => {
        if (actor !== 'linear:host' || reference !== 'linear:read')
          throw new Error('Secret access denied');
        authorize();
        const credential = secrets.getSecret(original.update.actor, 'linear:read');
        authorize();
        return credential;
      },
    },
    request,
    original.update,
  );
  authorize();
  return approvals.requestOnce(
    createApprovalRequest(
      {
        key: source.key,
        actor: { kind: 'agent', id: original.update.actor },
        taskId: original.update.taskId,
        eventId: null,
        operation: { ...operation, binding: original.binding },
      },
      identity,
    ),
  );
}
export async function executeApprovedTaskLinearUpdate(
  tasks: Pick<TaskProvider, 'get'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  scopes: readonly LinearAgentScope[],
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: { readonly taskId: string; readonly approvalId: string },
  now: () => string,
  mode: 'apply' | 'observe',
  phase?: 'running',
) {
  const executionId = input.taskId,
    approvalId = input.approvalId;
  const configured = parseLinearAgentScopes(scopes);
  const getApproved = () => {
    const raw = approvals.get(approvalId).request;
    return requireApprovedLinearRequest(
      approvals,
      { taskId: raw.taskId ?? '', actor: raw.actor.id, approvalId },
      'agent',
    );
  };
  const original = getApproved();
  if (
    original.operation.kind !== 'linear_issue_update' ||
    !original.operation.binding ||
    original.operation.binding.taskId !== executionId
  )
    throw new Error('Task Linear update Approval does not match Execution');
  const operation = original.operation,
    binding = operation.binding;
  if (!binding) throw new Error('Task Linear update binding missing');
  const parts = binding.proposalRef.split('/');
  const source = {
    taskId: binding.taskId,
    expectedVersion: binding.taskVersion,
    roomId: decodeURIComponent(parts[3] ?? ''),
    messageId: decodeURIComponent(parts[5] ?? ''),
    ...(phase === undefined ? {} : { phase }),
  };
  const resolve = () => resolveTaskLinearProposal(tasks, agents, rooms, configured, source);
  const initial = resolve();
  const authorize = () => {
    const current = getApproved(),
      proposal = resolve();
    const update =
      mode === 'observe'
        ? { ...proposal.update, expectedVersion: tasks.get(proposal.update.taskId).version }
        : proposal.update;
    const expected = {
      ...linearUpdateTarget(tasks, update),
      taskVersion: proposal.update.expectedVersion,
      baselineDigest: operation.baselineDigest,
      binding: proposal.binding,
    };
    if (
      !isDeepStrictEqual(current, original) ||
      current.actor.id !== proposal.update.actor ||
      current.taskId !== proposal.update.taskId ||
      !isDeepStrictEqual(expected, operation)
    )
      throw new Error('Task Linear update source or input changed');
    return current;
  };
  authorize();
  const guardedSecrets = {
    getSecret: (actor: string, reference: string) => {
      if (
        actor !== 'linear:host' ||
        !['linear:read', 'linear:write'].includes(reference) ||
        (mode === 'observe' && reference !== 'linear:read')
      )
        throw new Error('Secret access denied');
      authorize();
      const credential = secrets.getSecret(original.actor.id, reference);
      authorize();
      return credential;
    },
  };
  return mode === 'apply'
    ? applyApprovedLinearUpdate(
        tasks,
        approvals,
        events,
        guardedSecrets,
        request,
        { ...initial.update, approvalId },
        now,
        authorize,
      )
    : observeApprovedLinearUpdate(
        tasks,
        approvals,
        events,
        guardedSecrets,
        request,
        { taskId: initial.update.taskId, actor: initial.update.actor, approvalId },
        now,
        authorize,
      );
}
