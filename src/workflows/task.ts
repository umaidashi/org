import { createHash } from 'node:crypto';
import { requireCapability } from '../agents/domain.js';
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
): Promise<TaskArtifact> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30000),
    ...(cancellation ? [cancellation] : []),
  ]);
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
    return owner;
  };
  const owner = authorize();
  const proposal = parseWorkflowProposal(message.content);
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
        approvalId: null,
        effect: 'read_only',
      },
    },
    { id: requestId, createdAt: now() },
    now,
  );
  const executionId = started.payload.executionId;
  if (typeof executionId !== 'string') throw new Error('Workflow execution receipt invalid');
  let execution = await runtime.status(executionId);
  for (;;) {
    authorize();
    if (execution.id !== executionId || execution.workflowId !== proposal.workflowId)
      throw new Error('Workflow execution does not match Task proposal');
    if (execution.status === 'success') break;
    if (!['new', 'running', 'waiting'].includes(execution.status))
      throw new Error('Workflow did not complete successfully');
    await Bun.sleep(50);
    authorize();
    execution = await runtime.status(executionId);
  }
  authorize();
  const uri = await save(
    Buffer.from(
      JSON.stringify({
        proposalRef,
        requestId,
        taskId: running.id,
        workflowId: execution.workflowId,
        executionId,
        status: execution.status,
      }),
    ),
  );
  return { id: id(), uri, createdAt: now() };
}
