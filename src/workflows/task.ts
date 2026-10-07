import { TaskResultPendingError } from '../tasks/execution.js';
import { createEvent, type Event } from '../events/domain.js';
import { createHash } from 'node:crypto';
import { requireCapability, validateCapabilities, type Capability } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { Task, TaskArtifact } from '../tasks/domain.js';
import type { TaskProvider } from '../tasks/port.js';
import { requireTaskOwnerMessage } from '../tasks/proposal.js';
import type { RoomRepository } from '../rooms/port.js';
import type { Message } from '../rooms/domain.js';
import type { EventBus } from '../events/port.js';
import type { WorkflowRuntime } from './port.js';
import { invokeWorkflow } from './service.js';
import { parseWorkflowProposal } from './proposal.js';

export async function produceTaskWorkflowArtifact(
  tasks: Pick<TaskProvider, 'get'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get'>,
  bus: Pick<EventBus, 'publish'>,
  running: Task,
  message: Message,
  configured: {
    readonly host: string;
    readonly taskWaitTimeoutMs?: number;
    readonly workflows?: readonly {
      readonly id: string;
      readonly effect: 'read_only' | 'write' | 'irreversible';
      readonly requiredCapabilities?: readonly Capability[];
    }[];
    readonly requestApproval?: (
      running: Task,
      message: Message,
      effect: 'write' | 'irreversible',
      requiredCapabilities: readonly Capability[],
    ) => void;
    readonly approved?: { readonly approvalId: string };
    agentRuntime(
      agentId: string,
      workflowId: string,
      signal?: AbortSignal,
    ):
      | Pick<WorkflowRuntime, 'invoke' | 'status'>
      | Promise<Pick<WorkflowRuntime, 'invoke' | 'status'>>;
  },
  save: (bytes: Uint8Array) => Promise<string>,
  now: () => string,
  id: () => string,
  cancellation?: AbortSignal,
): Promise<TaskArtifact | null> {
  const timeoutMs = configured.taskWaitTimeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000)
    throw new Error('Invalid Workflow Task wait timeout');
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(cancellation ? [cancellation] : []),
  ]);
  let writeEffect = false;
  let requiredCapabilities: readonly Capability[] = [];
  const authorize = () => {
    if (signal.aborted) throw new Error('Workflow Task cancelled or timed out');
    const task = tasks.get(running.id);
    if (
      task.status !== 'running' ||
      task.version !== running.version ||
      task.owner !== running.owner
    )
      throw new Error('Workflow requires current running Task version');
    requireTaskOwnerMessage(task, rooms.get(message.roomId), message, running.version);
    const owner = agents.list().find((candidate) => candidate.id === task.owner);
    if (!owner) throw new Error('Task owner Agent not found');
    for (const capability of [
      'can_read',
      'can_delegate',
      'can_access_network',
      'can_contact_external',
    ] as const)
      requireCapability(owner, capability);
    if (writeEffect) requireCapability(owner, 'can_write');
    for (const capability of requiredCapabilities) requireCapability(owner, capability);
    return owner;
  };
  const owner = authorize();
  const proposal = parseWorkflowProposal(message.content);
  const workflow = configured.workflows?.find((workflow) => workflow.id === proposal.workflowId);
  const effect = workflow?.effect ?? 'read_only';
  requiredCapabilities = validateCapabilities(workflow?.requiredCapabilities ?? []);
  authorize();
  if (effect !== 'read_only') {
    writeEffect = true;
    requireCapability(owner, 'can_write');
    if (configured.approved === undefined) {
      if (!configured.requestApproval) throw new Error('Workflow operation Approval unavailable');
      configured.requestApproval(running, message, effect, requiredCapabilities);
      return null;
    }
  }
  const runtime = await configured.agentRuntime(owner.id, proposal.workflowId, signal);
  authorize();
  const requestId = 'workflow:task:' + createHash('sha256').update(running.id).digest('hex');
  const proposalRef = `org://rooms/${encodeURIComponent(message.roomId)}/messages/${encodeURIComponent(message.id)}`;
  const started = await invokeWorkflow(
    bus,
    runtime,
    {
      workflowId: proposal.workflowId,
      host: configured.host,
      input: proposal.input,
      inputDigest: createHash('sha256').update(JSON.stringify(proposal.input)).digest('hex'),
      context: {
        actorId: owner.id,
        actorKind: 'agent',
        eventId: running.externalRef?.startsWith('org:event:')
          ? running.externalRef.slice('org:event:'.length)
          : null,
        taskId: running.id,
        proposalRef,
        approvalId: configured.approved?.approvalId ?? null,
        effect,
      },
    },
    { id: requestId, createdAt: now() },
    now,
  );
  return collectTaskWorkflowArtifact(bus, runtime, started, running, authorize, save, now, id);
}

export async function collectTaskWorkflowArtifact(
  bus: Pick<EventBus, 'publish'>,
  runtime: Pick<WorkflowRuntime, 'status'>,
  started: Event,
  running: Task,
  authorize: () => void,
  save: (bytes: Uint8Array) => Promise<string>,
  now: () => string,
  id: () => string,
  priorUnconfirmed = false,
): Promise<TaskArtifact> {
  const requestId = started.payload.requestId,
    workflowId = started.payload.workflowId,
    host = started.payload.host,
    proposalRef = started.payload.proposalRef;
  if (
    typeof requestId !== 'string' ||
    typeof workflowId !== 'string' ||
    typeof host !== 'string' ||
    typeof proposalRef !== 'string'
  )
    throw new Error('Invalid Task Workflow started receipt');
  const executionId = started.payload.executionId;
  if (typeof executionId !== 'string') throw new Error('Workflow execution receipt invalid');
  let terminalObserved = false;
  let finalWorkflowId = workflowId;
  let finalStatus = 'success';
  try {
    authorize();
    let execution = await runtime.status(executionId);
    for (;;) {
      if (execution.id !== executionId || execution.workflowId !== workflowId)
        throw new Error('Workflow execution does not match Task proposal');
      if (['success', 'error', 'crashed', 'canceled'].includes(execution.status)) {
        bus.publish(
          createEvent(
            {
              type: 'workflow.status_observed',
              source: 'workflow:n8n',
              payload: {
                requestId,
                host: host,
                workflowId: execution.workflowId,
                executionId,
                status: execution.status,
                actorKind: 'system',
                actorId: 'host:workflow',
              },
            },
            { id: requestId + ':status:terminal', createdAt: now() },
          ),
        );
        terminalObserved = true;
        if (execution.status !== 'success')
          throw new Error('Workflow did not complete successfully');
        finalWorkflowId = execution.workflowId;
        finalStatus = execution.status;
        break;
      }
      authorize();
      if (!['new', 'running', 'waiting'].includes(execution.status))
        throw new Error('Workflow outcome unknown');
      await Bun.sleep(50);
      authorize();
      execution = await runtime.status(executionId);
    }
  } catch (error) {
    if (!terminalObserved && !priorUnconfirmed) {
      try {
        bus.publish(
          createEvent(
            {
              type: 'workflow.unconfirmed',
              source: 'workflow:n8n',
              payload: { ...started.payload, requestId, executionId, phase: 'observation' },
            },
            { id: requestId + ':unconfirmed', createdAt: now() },
          ),
        );
      } catch (failure) {
        throw new AggregateError(
          [error, failure],
          'Workflow observation and receipt are unconfirmed',
        );
      }
    }
    if (!terminalObserved)
      throw new TaskResultPendingError('Workflow execution result remains pending');
    throw error;
  }
  authorize();
  const uri = await save(
    Buffer.from(
      JSON.stringify({
        proposalRef,
        requestId,
        taskId: running.id,
        workflowId: finalWorkflowId,
        executionId,
        status: finalStatus,
      }),
    ),
  );
  return { id: id(), uri, createdAt: now() };
}
