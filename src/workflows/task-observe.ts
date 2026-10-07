import { createHash } from 'node:crypto';
import { createEvent } from '../events/domain.js';
import { isDeepStrictEqual } from 'node:util';
import { changeTask, type Task } from '../tasks/domain.js';
import { TaskResultPendingError } from '../tasks/execution.js';
import type { TaskProvider, ExecutionResultWriter } from '../tasks/port.js';
import type { AgentRepository } from '../agents/port.js';
import { requireCapability, type Capability } from '../agents/domain.js';
import type { RoomRepository } from '../rooms/port.js';
import { requireTaskOwnerMessage } from '../tasks/proposal.js';
import type { ApprovalStore } from '../approvals/port.js';
import {
  createApprovalRequest,
  createApprovalDecision,
  parseTaskWorkflowBinding,
  type Approval,
} from '../approvals/domain.js';
import type { EventBus } from '../events/port.js';
import { buildWorkflowAudit } from '../audit/workflows.js';
import type { WorkflowRuntime } from './port.js';
import { parseWorkflowProposal } from './proposal.js';
import { requestTaskWorkflowApproval } from './task-approval.js';
import { collectTaskWorkflowArtifact } from './task.js';

export function recoverInterruptedTaskWorkflows(
  tasks: Pick<TaskProvider, 'list' | 'update'>,
  bus: Pick<EventBus, 'list' | 'publishOnce'>,
  now: () => string,
): void {
  const originals = new Map(bus.list().map((event) => [event.id, event]));
  for (const task of tasks.list({ kind: 'execution_task', status: 'running' })) {
    if (task.kind !== 'execution_task' || task.status !== 'running') continue;
    const requestId = 'workflow:task:' + createHash('sha256').update(task.id).digest('hex');
    const claim = originals.get(requestId);
    if (!claim) continue;
    if (
      claim.type !== 'workflow.requested' ||
      claim.source !== 'workflow:n8n' ||
      claim.payload.taskId !== task.id ||
      claim.payload.actorKind !== 'agent' ||
      claim.payload.actorId !== task.owner
    )
      throw new Error('Interrupted Workflow claim does not match Task');
    const started = originals.get(requestId + ':started'),
      uncertain = originals.get(requestId + ':unconfirmed');
    const receipts = [claim, ...(started ? [started] : []), ...(uncertain ? [uncertain] : [])];
    if (buildWorkflowAudit(receipts).length !== receipts.length)
      throw new Error('Interrupted Workflow receipts invalid');
    if (
      started &&
      (started.type !== 'workflow.started' ||
        started.payload.requestId !== requestId ||
        typeof started.payload.executionId !== 'string' ||
        !started.payload.executionId.trim())
    )
      throw new Error('Interrupted Workflow execution receipt invalid');
    // ponytail: durable receipt before Task CAS; startup retries this boundary, never external invocation.
    if (started && !uncertain)
      bus.publishOnce(
        createEvent(
          {
            type: 'workflow.unconfirmed',
            source: 'workflow:n8n',
            payload: { ...started.payload, phase: 'observation' },
          },
          { id: requestId + ':unconfirmed', createdAt: now() },
        ),
      );
    tasks.update(task.id, { status: 'blocked' }, now(), task.version);
  }
}
export async function observeTaskWorkflow(
  tasks: Pick<TaskProvider, 'get' | 'history' | 'update'> & ExecutionResultWriter,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  approvals: Pick<ApprovalStore, 'get'>,
  bus: Pick<EventBus, 'get' | 'publish' | 'list'>,
  configured: {
    readonly host: string;
    readonly taskWaitTimeoutMs?: number;
    readonly workflows: readonly {
      readonly id: string;
      readonly effect: 'read_only' | 'write' | 'irreversible';
      readonly requiredCapabilities?: readonly Capability[];
    }[];
    agentRuntime(
      agentId: string,
      workflowId: string,
      signal?: AbortSignal,
    ): Pick<WorkflowRuntime, 'status'> | Promise<Pick<WorkflowRuntime, 'status'>>;
    approvedAgentRuntime(
      agentId: string,
      workflowId: string,
      approval: Approval,
      signal?: AbortSignal,
    ): Pick<WorkflowRuntime, 'status'> | Promise<Pick<WorkflowRuntime, 'status'>>;
  },
  input: {
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly readyOnly?: boolean;
  },
  save: (bytes: Uint8Array) => Promise<string>,
  now: () => string,
  id: () => string,
  cancellation?: AbortSignal,
): Promise<Task> {
  const timeoutMs = configured.taskWaitTimeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000)
    throw new Error('Invalid Workflow Task wait timeout');
  const authorize = () => {
    if (cancellation?.aborted) throw new Error('Workflow Task cancelled');
    const blocked = tasks.get(input.taskId);
    if (
      blocked.id !== input.taskId ||
      blocked.kind !== 'execution_task' ||
      blocked.status !== 'blocked' ||
      blocked.version !== input.expectedVersion ||
      blocked.owner === null ||
      blocked.outputArtifacts.length !== 0
    )
      throw new Error('Workflow observation requires current pending blocked Task');
    const history = tasks.history(blocked.id),
      previous = history.find((entry) => entry.version === blocked.version - 1)?.task;
    if (
      !previous ||
      previous.status !== 'running' ||
      !isDeepStrictEqual(changeTask(previous, { status: 'blocked' }, blocked.updatedAt), blocked)
    )
      throw new Error('Workflow pending Task snapshot mismatch');
    const requestId = 'workflow:task:' + createHash('sha256').update(blocked.id).digest('hex');
    const claim = bus.get(requestId),
      started = bus.get(requestId + ':started');
    const receipts = bus.list();
    const uncertain = receipts.find((event) => event.id === requestId + ':unconfirmed');
    const priorTerminal = receipts.find((event) => event.id === requestId + ':status:terminal');
    if (
      claim.id !== requestId ||
      claim.type !== 'workflow.requested' ||
      claim.source !== 'workflow:n8n' ||
      started.id !== requestId + ':started' ||
      started.type !== 'workflow.started' ||
      started.payload.requestId !== requestId ||
      typeof started.payload.executionId !== 'string' ||
      (!uncertain && !priorTerminal) ||
      (uncertain &&
        (uncertain.type !== 'workflow.unconfirmed' ||
          uncertain.payload.requestId !== requestId ||
          uncertain.payload.phase !== 'observation' ||
          uncertain.payload.executionId !== started.payload.executionId))
    )
      throw new Error('Workflow pending receipts missing');
    const audit = buildWorkflowAudit([claim, started, ...(uncertain ? [uncertain] : [])]);
    if (priorTerminal) {
      if (
        priorTerminal.type !== 'workflow.status_observed' ||
        priorTerminal.source !== claim.source ||
        priorTerminal.payload.actorKind !== 'system' ||
        priorTerminal.payload.actorId !== 'host:workflow'
      )
        throw new Error('Workflow terminal receipt invalid');
      buildWorkflowAudit([claim, started, priorTerminal]);
    }
    if (
      audit.length !== (uncertain ? 3 : 2) ||
      claim.payload.host !== configured.host ||
      claim.payload.taskId !== blocked.id ||
      claim.payload.actorKind !== 'agent' ||
      claim.payload.actorId !== blocked.owner ||
      claim.payload.eventId !==
        (blocked.externalRef?.startsWith('org:event:')
          ? blocked.externalRef.slice('org:event:'.length)
          : null)
    )
      throw new Error('Workflow claim does not match current Task');
    const binding = parseTaskWorkflowBinding({
      taskVersion: previous.version,
      proposalRef: claim.payload.proposalRef,
    });
    const match = /^org:\/\/rooms\/([^/]+)\/messages\/([^/]+)$/.exec(binding.proposalRef);
    if (!match) throw new Error('Invalid Workflow proposal reference');
    const roomId = decodeURIComponent(match[1] ?? ''),
      messageId = decodeURIComponent(match[2] ?? '');
    const room = rooms.get(roomId),
      message = rooms.messages(roomId).find((m) => m.id === messageId);
    if (!message || room.id !== roomId) throw new Error('Workflow proposal missing');
    requireTaskOwnerMessage(previous, room, message, previous.version);
    const proposal = parseWorkflowProposal(message.content),
      workflow = configured.workflows.find((w) => w.id === proposal.workflowId);
    if (
      !workflow ||
      claim.payload.workflowId !== workflow.id ||
      claim.payload.effect !== workflow.effect ||
      claim.payload.inputDigest !==
        createHash('sha256').update(JSON.stringify(proposal.input)).digest('hex')
    )
      throw new Error('Workflow observation host or input scope mismatch');
    const owner = agents.list().find((a) => a.id === blocked.owner);
    if (!owner) throw new Error('Task owner Agent not found');
    for (const capability of [
      'can_read',
      'can_delegate',
      'can_access_network',
      'can_contact_external',
    ] as const)
      requireCapability(owner, capability);
    if (blocked.dependencies.some((dep) => tasks.get(dep).status !== 'completed'))
      throw new Error('Task dependencies not complete');
    for (const capability of workflow.requiredCapabilities ?? [])
      requireCapability(owner, capability);
    let approval: Approval | undefined;
    if (workflow.effect !== 'read_only') {
      if (typeof claim.payload.approvalId !== 'string')
        throw new Error('Workflow operation Approval missing');
      approval = approvals.get(claim.payload.approvalId);
      const { request, decision } = approval;
      createApprovalRequest(request, request);
      if (
        request.id !== claim.payload.approvalId ||
        !decision ||
        decision.decision !== 'approve' ||
        decision.approvalId !== request.id ||
        request.operation.kind !== 'workflow_invocation' ||
        !request.operation.binding
      )
        throw new Error('Workflow operation Approval mismatch');
      createApprovalDecision(request, decision, decision.createdAt);
      const originalVersion = request.operation.binding.taskVersion;
      const original = history.find((entry) => entry.version === originalVersion)?.task;
      if (
        !original ||
        !isDeepStrictEqual(
          {
            ...blocked,
            status: original.status,
            version: original.version,
            updatedAt: original.updatedAt,
          },
          original,
        )
      )
        throw new Error('Original approved Task changed');
      const expected = requestTaskWorkflowApproval(
        { get: () => original },
        agents,
        rooms,
        { requestOnce: (r) => r },
        {
          taskId: blocked.id,
          roomId,
          messageId,
          expectedVersion: original.version,
          host: configured.host,
          effect: workflow.effect,
          requiredCapabilities: workflow.requiredCapabilities ?? [],
          phase: 'running',
        },
        { id: request.id, createdAt: request.createdAt },
      );
      if (!isDeepStrictEqual(expected, request))
        throw new Error('Original Workflow Approval changed');
    } else if (claim.payload.approvalId !== null)
      throw new Error('Unexpected read-only Workflow Approval');
    return {
      blocked,
      started,
      message,
      room,
      owner,
      workflow,
      approval,
      priorTerminal,
      priorUnconfirmed: uncertain !== undefined,
    };
  };
  const first = authorize();
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(cancellation ? [cancellation] : []),
  ]);
  const runtime =
    first.approval === undefined
      ? await configured.agentRuntime(first.owner.id, first.workflow.id, signal)
      : await configured.approvedAgentRuntime(
          first.owner.id,
          first.workflow.id,
          first.approval,
          signal,
        );
  const verified = authorize();
  if (input.readyOnly) {
    const execution = await runtime.status(verified.started.payload.executionId as string);
    authorize();
    if (signal.aborted) throw new Error('Workflow observation stopped');
    if (
      execution.id !== verified.started.payload.executionId ||
      execution.workflowId !== verified.workflow.id
    )
      throw new Error('Workflow execution does not match Task proposal');
    if (['new', 'running', 'waiting'].includes(execution.status)) return verified.blocked;
    if (!['success', 'error', 'crashed', 'canceled'].includes(execution.status))
      throw new Error('Workflow outcome unknown');
  }
  const running = tasks.update(
    verified.blocked.id,
    { status: 'running' },
    now(),
    verified.blocked.version,
  );
  const authorizeRunning = () => {
    if (signal.aborted) throw new Error('Workflow observation stopped');
    const current = tasks.get(running.id);
    if (
      current.status !== 'running' ||
      current.version !== running.version ||
      current.owner !== running.owner
    )
      throw new Error('Workflow observation Task changed');
    requireTaskOwnerMessage(
      current,
      rooms.get(verified.room.id),
      verified.message,
      running.version,
    );
    const owner = agents.list().find((a) => a.id === current.owner);
    if (!owner) throw new Error('Task owner missing');
    for (const capability of [
      'can_read',
      'can_delegate',
      'can_access_network',
      'can_contact_external',
    ] as const)
      requireCapability(owner, capability);
    if (verified.workflow.effect !== 'read_only') requireCapability(owner, 'can_write');
    for (const capability of verified.workflow.requiredCapabilities ?? [])
      requireCapability(owner, capability);
  };
  try {
    const artifact = await collectTaskWorkflowArtifact(
      bus,
      runtime,
      verified.started,
      running,
      authorizeRunning,
      save,
      now,
      id,
      verified.priorUnconfirmed,
      verified.priorTerminal,
    );
    return tasks.stageExecutionResult(running.id, artifact, running.version);
  } catch (error) {
    try {
      tasks.update(
        running.id,
        { status: error instanceof TaskResultPendingError ? 'blocked' : 'failed' },
        now(),
        running.version,
      );
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Workflow observation failed and Task could not be recorded',
      );
    }
    throw error;
  }
}

export async function pollTaskWorkflowObservations(
  tasks: Pick<TaskProvider, 'list' | 'get'>,
  bus: Pick<EventBus, 'list'>,
  observe: (id: string, version: number) => Promise<Task>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  // ponytail: scan the local journal; use an indexed receipt query when history size matters.
  const originals = bus.list();
  const claims = new Map(originals.map((event) => [event.id, event]));
  // ponytail: local Artifact retry follows host polling; add backoff if prolonged storage outages cause measured churn.
  const pending = new Set(
    originals
      .filter(
        (e) =>
          e.source === 'workflow:n8n' &&
          ((e.type === 'workflow.unconfirmed' && e.payload.phase === 'observation') ||
            (e.type === 'workflow.status_observed' &&
              e.payload.status === 'success' &&
              typeof e.payload.requestId === 'string' &&
              e.id === e.payload.requestId + ':status:terminal')),
      )
      .map((e) =>
        e.type === 'workflow.unconfirmed'
          ? e.payload.taskId
          : typeof e.payload.requestId === 'string'
            ? claims.get(e.payload.requestId)?.payload.taskId
            : undefined,
      ),
  );
  const errors: unknown[] = [];
  for (const candidate of tasks.list({ kind: 'execution_task', status: 'blocked' })) {
    if (signal?.aborted) return;
    if (
      candidate.kind !== 'execution_task' ||
      candidate.status !== 'blocked' ||
      !pending.has(candidate.id)
    )
      continue;
    const task = tasks.get(candidate.id);
    if (task.id !== candidate.id || task.kind !== 'execution_task' || task.status !== 'blocked')
      continue;
    try {
      await observe(task.id, task.version);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Workflow observation polling failed');
}
