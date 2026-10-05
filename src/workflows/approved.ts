import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, createApprovalDecision } from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { Participant } from '../rooms/domain.js';
import type { EventBus } from '../events/port.js';
import type { JsonObject, Identity } from '../events/domain.js';
import type { WorkflowRuntime } from './port.js';
import { invokeWorkflow } from './service.js';
export async function invokeApprovedWorkflow(
  store: Pick<ApprovalStore, 'get'>,
  bus: Pick<EventBus, 'publish'>,
  runtime: Pick<WorkflowRuntime, 'invoke'>,
  input: {
    readonly workflowId: string;
    readonly host: string;
    readonly input: JsonObject;
    readonly effect: 'write' | 'irreversible';
    readonly approvalId: string;
    readonly actor: Participant;
  },
  identity: Identity,
  now: () => string,
) {
  const approval = store.get(input.approvalId),
    { request, decision } = approval;
  if (decision === null || decision.decision !== 'approve')
    throw new Error('Workflow operation must be approved');
  createApprovalRequest(request, request);
  createApprovalDecision(request, decision, decision.createdAt);
  const digest = createHash('sha256').update(JSON.stringify(input.input)).digest('hex');
  const expected = {
    kind: 'workflow_invocation',
    host: input.host,
    workflowId: input.workflowId,
    inputDigest: digest,
    requestId: identity.id,
    effect: input.effect,
  };
  if (
    request.id !== input.approvalId ||
    decision.approvalId !== request.id ||
    input.actor.kind !== 'human' ||
    request.actor.kind !== 'human' ||
    !isDeepStrictEqual(request.actor, input.actor) ||
    request.taskId !== null ||
    request.eventId !== null ||
    !isDeepStrictEqual(request.operation, expected)
  )
    throw new Error('Workflow Approval does not match operation or actor');
  return invokeWorkflow(
    bus,
    runtime,
    {
      workflowId: input.workflowId,
      host: input.host,
      input: input.input,
      inputDigest: digest,
      context: {
        actorId: input.actor.id,
        actorKind: 'human',
        taskId: null,
        proposalRef: null,
        approvalId: request.id,
        effect: input.effect,
      },
    },
    identity,
    now,
  );
}
