import { isDeepStrictEqual } from 'node:util';
import { changeTask, type Task } from '../tasks/domain.js';
import type { TaskProvider, ExecutionResultWriter } from '../tasks/port.js';
import { TaskResultPendingError, stagePendingExecutionResult } from '../tasks/execution.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { ApprovalRequest, LinearIssueUpdateOperation } from '../approvals/domain.js';
import type { EventBus } from '../events/port.js';
import type { SecretStore } from '../secrets/port.js';
import { requireApprovedLinearRequest, linearClaimPayload } from './operation.js';
import { executeApprovedTaskLinearUpdate, resolveTaskLinearProposal } from './task-approval.js';
import { parseLinearAgentScopes, type LinearAgentScope } from './agent-read.js';

function approvedTaskUpdate(
  approvals: Pick<ApprovalStore, 'get'>,
  taskId: string,
  approvalId: string,
) {
  const raw = approvals.get(approvalId).request;
  const request = requireApprovedLinearRequest(
    approvals,
    { taskId: raw.taskId ?? '', actor: raw.actor.id, approvalId },
    'agent',
  );
  if (
    request.operation.kind !== 'linear_issue_update' ||
    request.operation.binding?.taskId !== taskId
  )
    throw new Error('Linear Task Approval binding mismatch');
  return { ...request, operation: request.operation };
}

function originalTask(
  tasks: Pick<TaskProvider, 'history'>,
  current: Task,
  request: ApprovalRequest & { readonly operation: LinearIssueUpdateOperation },
) {
  const binding = request.operation.binding;
  if (
    !binding ||
    current.id !== binding.taskId ||
    current.kind !== 'execution_task' ||
    current.outputArtifacts.length
  )
    throw new Error('Linear Task source mismatch');
  const history = tasks.history(current.id);
  const index = history.findIndex((entry) => entry.version === binding.taskVersion);
  const original = history[index]?.task;
  if (
    !original ||
    history[index]?.status !== original.status ||
    original.version !== binding.taskVersion ||
    original.id !== current.id ||
    original.status !== 'running' ||
    original.owner !== request.actor.id ||
    original.parentId !== request.taskId ||
    original.outputArtifacts.length ||
    !isDeepStrictEqual(history.at(-1)?.task, current)
  )
    throw new Error('Linear Task original running snapshot missing');
  let previous = original;
  const subsequent = history.slice(index + 1);
  if (!subsequent.length || subsequent[0]?.status !== 'waiting_approval')
    throw new Error('Linear Task operation waiting snapshot missing');
  for (const [offset, entry] of subsequent.entries()) {
    if (
      entry.version !== entry.task.version ||
      entry.status !== entry.task.status ||
      (offset > 0 && !['running', 'blocked'].includes(entry.status)) ||
      !isDeepStrictEqual(changeTask(previous, { status: entry.status }, entry.at), entry.task)
    )
      throw new Error('Linear Task changed since original proposal');
    previous = entry.task;
  }
  return original;
}

function matchingClaim(
  events: Pick<EventBus, 'list'>,
  request: ApprovalRequest & { readonly operation: LinearIssueUpdateOperation },
) {
  const payload = linearClaimPayload(request);
  const claim = events.list().find((event) => event.id === payload.claimId);
  if (!claim) return false;
  if (
    claim.type !== 'linear.update.claimed' ||
    claim.source !== 'linear:host' ||
    !isDeepStrictEqual(claim.payload, payload)
  )
    throw new Error('Linear Task claim mismatched');
  return true;
}

export async function resumeTaskLinearUpdate(
  tasks: Pick<TaskProvider, 'get' | 'history' | 'update'> & ExecutionResultWriter,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  scopes: readonly LinearAgentScope[],
  secrets: Pick<SecretStore, 'getSecret'>,
  http: (url: string, init: RequestInit) => Promise<Response>,
  input: { readonly taskId: string; readonly approvalId: string; readonly expectedVersion: number },
  save: (bytes: Uint8Array) => Promise<string>,
  now: () => string,
  mode: 'apply' | 'observe',
  signal?: AbortSignal,
): Promise<Task> {
  const taskId = input.taskId,
    approvalId = input.approvalId,
    version = input.expectedVersion;
  const configured = parseLinearAgentScopes(scopes);
  const request = approvedTaskUpdate(approvals, taskId, approvalId);
  let active = tasks.get(taskId);
  if (
    active.id !== taskId ||
    active.version !== version ||
    active.status !== (mode === 'apply' ? 'waiting_approval' : 'blocked')
  )
    throw new Error('Linear Task requires current operation-waiting or blocked version');
  const original = originalTask(tasks, active, request);
  const check = () => {
    if (signal?.aborted) throw new Error('Linear Task cancelled');
    const current = tasks.get(taskId);
    if (
      !isDeepStrictEqual(current, active) ||
      !isDeepStrictEqual(approvedTaskUpdate(approvals, taskId, approvalId), request) ||
      !isDeepStrictEqual(originalTask(tasks, current, request), original)
    )
      throw new Error('Linear Task authority or snapshot changed');
    if (original.dependencies.some((id) => tasks.get(id).status !== 'completed'))
      throw new Error('Task dependencies are not complete');
  };
  const source = {
    get: (id: string) => {
      check();
      return id === taskId ? original : tasks.get(id);
    },
  };
  const binding = request.operation.binding;
  if (!binding) throw new Error('Linear Task binding missing');
  const parts = binding.proposalRef.split('/');
  resolveTaskLinearProposal(source, agents, rooms, configured, {
    taskId,
    expectedVersion: original.version,
    roomId: decodeURIComponent(parts[3] ?? ''),
    messageId: decodeURIComponent(parts[5] ?? ''),
    phase: 'running',
  });
  if (mode === 'apply' && matchingClaim(events, request))
    throw new Error('Linear Task already claimed; observe instead of retrying');
  if (mode === 'observe' && !matchingClaim(events, request))
    throw new Error('Linear Task observation requires original claim');
  check();
  active = tasks.update(taskId, { status: 'running' }, now(), version);
  try {
    const receipt = await executeApprovedTaskLinearUpdate(
      source,
      agents,
      rooms,
      approvals,
      events,
      configured,
      secrets,
      http,
      { taskId, approvalId },
      now,
      mode,
      'running',
    );
    let uri: string;
    try {
      uri = await save(new TextEncoder().encode(JSON.stringify(receipt)));
    } catch (error) {
      throw new TaskResultPendingError('Linear receipt Artifact remains pending', { cause: error });
    }
    check();
    return stagePendingExecutionResult(tasks, active, { id: receipt.id, uri, createdAt: now() });
  } catch (error) {
    try {
      tasks.update(
        taskId,
        {
          status:
            error instanceof TaskResultPendingError || matchingClaim(events, request)
              ? 'blocked'
              : 'failed',
        },
        now(),
        active.version,
      );
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Linear Task failed and state could not be recorded',
      );
    }
    throw error;
  }
}

export function recoverInterruptedTaskLinearUpdates(
  tasks: Pick<TaskProvider, 'list' | 'history' | 'update'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list'>,
  now: () => string,
): void {
  // ponytail: scan local claims at startup; index binding Task IDs if journal size makes recovery slow.
  for (const current of tasks.list({ kind: 'execution_task', status: 'running' })) {
    const candidates = events.list().filter((event) => {
      const operation = event.payload.operation;
      return (
        event.type === 'linear.update.claimed' &&
        operation !== null &&
        typeof operation === 'object' &&
        !Array.isArray(operation) &&
        'binding' in operation &&
        operation.binding !== null &&
        typeof operation.binding === 'object' &&
        !Array.isArray(operation.binding) &&
        'taskId' in operation.binding &&
        operation.binding.taskId === current.id
      );
    });
    if (!candidates.length) continue;
    if (candidates.length !== 1) throw new Error('Interrupted Linear Task claim ambiguous');
    const approvalId = candidates[0]?.payload.approvalId;
    if (typeof approvalId !== 'string') throw new Error('Interrupted Linear Task Approval missing');
    const request = approvedTaskUpdate(approvals, current.id, approvalId);
    if (!matchingClaim(events, request)) throw new Error('Interrupted Linear Task claim missing');
    if (
      tasks
        .history(current.id)
        .find((entry) => entry.version === request.operation.binding?.taskVersion)?.task.status ===
      'assigned'
    )
      continue;
    originalTask(tasks, current, request);
    tasks.update(current.id, { status: 'blocked' }, now(), current.version);
  }
}
