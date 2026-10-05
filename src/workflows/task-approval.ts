import { createHash } from 'node:crypto';
import { requireCapability } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { ApprovalStore } from '../approvals/port.js';
import { createApprovalRequest } from '../approvals/domain.js';
import type { ApprovalRequest, WorkflowOperation } from '../approvals/domain.js';
import { requireTaskOwnerMessage } from '../tasks/proposal.js';
import { parseWorkflowProposal } from './proposal.js';
export interface TaskWorkflowApprovalInput {
  readonly taskId: string;
  readonly roomId: string;
  readonly messageId: string;
  readonly expectedVersion: number;
  readonly host: string;
  readonly effect: 'write' | 'irreversible';
  readonly phase?: 'running';
}
export function requestTaskWorkflowApproval(
  tasks: Pick<TaskProvider, 'get'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  approvals: Pick<ApprovalStore, 'requestOnce'>,
  input: TaskWorkflowApprovalInput,
  identity: { readonly id: string; readonly createdAt: string },
): ApprovalRequest & { readonly operation: WorkflowOperation } {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw new Error('Invalid Task version');
  const task = tasks.get(input.taskId);
  if (task.id !== input.taskId || task.version !== input.expectedVersion)
    throw new Error('Task version mismatch');
  const room = rooms.get(input.roomId);
  if (room.id !== input.roomId) throw new Error('Room mismatch');
  const message = rooms.messages(input.roomId).find((m) => m.id === input.messageId);
  if (!message) throw new Error('Task proposal Message not found');
  requireTaskOwnerMessage(
    task,
    room,
    message,
    input.phase === 'running' ? input.expectedVersion : undefined,
  );
  const owner = agents.list().find((a) => a.id === task.owner);
  if (!owner) throw new Error('Task owner Agent not found');
  for (const capability of [
    'can_read',
    'can_delegate',
    'can_access_network',
    'can_contact_external',
    'can_write',
  ] as const)
    requireCapability(owner, capability);
  const proposal = parseWorkflowProposal(message.content);
  const requestId = 'workflow:task:' + createHash('sha256').update(task.id).digest('hex');
  const request = createApprovalRequest(
    {
      key: requestId,
      actor: { kind: 'agent', id: owner.id },
      taskId: task.id,
      eventId: task.externalRef?.startsWith('org:event:')
        ? task.externalRef.slice('org:event:'.length)
        : null,
      operation: {
        kind: 'workflow_invocation',
        host: input.host,
        workflowId: proposal.workflowId,
        inputDigest: createHash('sha256').update(JSON.stringify(proposal.input)).digest('hex'),
        requestId,
        effect: input.effect,
        binding: {
          taskVersion: task.version,
          proposalRef: `org://rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(message.id)}`,
        },
      },
    },
    identity,
  );
  const saved = approvals.requestOnce(request);
  if (saved.operation.kind !== 'workflow_invocation')
    throw new Error('Task Workflow Approval operation mismatch');
  return { ...saved, operation: saved.operation };
}
