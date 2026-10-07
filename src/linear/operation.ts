import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, createApprovalDecision } from '../approvals/domain.js';
import type {
  ApprovalRequest,
  LinearCommentOperation,
  LinearArtifactLinkOperation,
  LinearIssueUpdateOperation,
} from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { EventBus } from '../events/port.js';
import type { Event } from '../events/domain.js';
export function requireApprovedLinearRequest(
  approvals: Pick<ApprovalStore, 'get'>,
  input: { readonly taskId: string; readonly actor: string; readonly approvalId: string },
): ApprovalRequest {
  const { request, decision } = approvals.get(input.approvalId);
  createApprovalRequest(request, request);
  if (!decision || decision.decision !== 'approve')
    throw new Error('Linear operation must be approved');
  createApprovalDecision(request, decision, decision.createdAt);
  if (
    request.id !== input.approvalId ||
    decision.approvalId !== request.id ||
    !isDeepStrictEqual(request.actor, { kind: 'human', id: input.actor }) ||
    request.taskId !== input.taskId
  )
    throw new Error('Linear Approval does not match input');
  return request;
}
export function linearClaimPayload(
  request: ApprovalRequest & {
    readonly operation:
      | LinearCommentOperation
      | LinearArtifactLinkOperation
      | LinearIssueUpdateOperation;
  },
) {
  return {
    claimId:
      request.operation.kind === 'linear_comment'
        ? `linear-comment:${request.operation.commentId}`
        : request.operation.kind === 'linear_artifact_link'
          ? `linear-artifact:${request.id}`
          : `linear-update:${request.id}`,
    approvalId: request.id,
    actorKind: request.actor.kind,
    actorId: request.actor.id,
    taskId: request.taskId,
    operation: { ...request.operation },
  };
}
export function publishVerifiedLinearReceipt(
  events: Pick<EventBus, 'list' | 'publish'>,
  receipt: Event,
): Event {
  try {
    return events.publish(receipt);
  } catch (error) {
    // ponytail: immutable ID elects one receipt; accept a concurrent winner only when its verified context is identical.
    const winner = events.list().find((e) => e.id === receipt.id);
    if (
      !winner ||
      winner.type !== receipt.type ||
      winner.source !== receipt.source ||
      !isDeepStrictEqual(winner.payload, receipt.payload)
    )
      throw error;
    return winner;
  }
}
