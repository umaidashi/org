import { isDeepStrictEqual } from 'node:util';
import { changeTask, type Task } from '../tasks/domain.js';
import type { TaskProvider, ExecutionResultWriter } from '../tasks/port.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { Approval } from '../approvals/domain.js';
import { createApprovalRequest, createApprovalDecision } from '../approvals/domain.js';
import type { EventBus } from '../events/port.js';
import type { WorkflowRuntime } from './port.js';
import { requestTaskWorkflowApproval } from './task-approval.js';
import { produceTaskWorkflowArtifact } from './task.js';
export async function resumeTaskWorkflow(
  tasks: Pick<TaskProvider, 'get' | 'history' | 'update'> & ExecutionResultWriter,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  approvals: Pick<ApprovalStore, 'get'>,
  bus: Pick<EventBus, 'publish'>,
  configured: {
    readonly host: string;
    readonly workflows: readonly {
      readonly id: string;
      readonly effect: 'read_only' | 'write' | 'irreversible';
    }[];
    approvedAgentRuntime(
      agentId: string,
      workflowId: string,
      approval: Approval,
      signal?: AbortSignal,
    ):
      | Pick<WorkflowRuntime, 'invoke' | 'status'>
      | Promise<Pick<WorkflowRuntime, 'invoke' | 'status'>>;
  },
  input: { readonly taskId: string; readonly approvalId: string; readonly expectedVersion: number },
  save: (bytes: Uint8Array) => Promise<string>,
  now: () => string,
  id: () => string,
  signal?: AbortSignal,
): Promise<Task> {
  const authorize = () => {
    if (signal?.aborted) throw new Error('Workflow Task cancelled');
    const waiting = tasks.get(input.taskId);
    if (
      waiting.id !== input.taskId ||
      waiting.kind !== 'execution_task' ||
      waiting.status !== 'waiting_approval' ||
      waiting.version !== input.expectedVersion ||
      waiting.outputArtifacts.length !== 0
    )
      throw new Error('Workflow resume requires current operation-waiting Task');
    const approval = approvals.get(input.approvalId),
      { request, decision } = approval;
    createApprovalRequest(request, request);
    if (
      request.id !== input.approvalId ||
      !decision ||
      decision.approvalId !== request.id ||
      decision.decision !== 'approve'
    )
      throw new Error('Workflow Task requires human Approval');
    createApprovalDecision(request, decision, decision.createdAt);
    if (request.operation.kind !== 'workflow_invocation' || !request.operation.binding)
      throw new Error('Task Workflow binding missing');
    const operation = request.operation,
      binding = operation.binding;
    if (!binding) throw new Error('Task Workflow binding missing');
    const original = tasks
      .history(waiting.id)
      .find((entry) => entry.version === binding.taskVersion)?.task;
    if (
      !original ||
      original.id !== waiting.id ||
      original.status !== 'running' ||
      !isDeepStrictEqual(
        changeTask(original, { status: 'waiting_approval' }, waiting.updatedAt),
        waiting,
      )
    )
      throw new Error('Workflow Task waiting snapshot changed');
    const workflow = configured.workflows.find((w) => w.id === operation.workflowId);
    if (!workflow || workflow.effect === 'read_only' || workflow.effect !== operation.effect)
      throw new Error('Task Workflow host scope denied');
    const match = /^org:\/\/rooms\/([^/]+)\/messages\/([^/]+)$/.exec(binding.proposalRef);
    if (!match) throw new Error('Task Workflow proposal reference invalid');
    const roomId = decodeURIComponent(match[1] ?? ''),
      messageId = decodeURIComponent(match[2] ?? '');
    const expected = requestTaskWorkflowApproval(
      { get: () => original },
      agents,
      rooms,
      { requestOnce: (r) => r },
      {
        taskId: waiting.id,
        roomId,
        messageId,
        expectedVersion: original.version,
        host: configured.host,
        effect: workflow.effect,
        phase: 'running',
      },
      { id: request.id, createdAt: request.createdAt },
    );
    if (!isDeepStrictEqual(expected, request))
      throw new Error('Task Workflow Approval does not match original proposal');
    if (original.dependencies.some((dep) => tasks.get(dep).status !== 'completed'))
      throw new Error('Task dependencies are not complete');
    const message = rooms.messages(roomId).find((m) => m.id === messageId);
    if (!message || waiting.owner === null) throw new Error('Task proposal missing');
    return { waiting, message, approval, workflow, owner: waiting.owner };
  };
  const first = authorize();
  const runtime = await configured.approvedAgentRuntime(
    first.owner,
    first.workflow.id,
    first.approval,
    signal,
  );
  const verified = authorize();
  const running = tasks.update(
    verified.waiting.id,
    { status: 'running' },
    now(),
    verified.waiting.version,
  );
  try {
    const artifact = await produceTaskWorkflowArtifact(
      tasks,
      agents,
      rooms,
      bus,
      running,
      verified.message,
      {
        ...configured,
        approved: { approvalId: verified.approval.request.id },
        agentRuntime: () => runtime,
      },
      save,
      now,
      id,
      signal,
    );
    if (artifact === null) throw new Error('Approved Workflow result missing');
    return tasks.stageExecutionResult(running.id, artifact, running.version);
  } catch (error) {
    try {
      tasks.update(running.id, { status: 'failed' }, now(), running.version);
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Workflow Task failed and state could not be recorded',
      );
    }
    throw error;
  }
}
