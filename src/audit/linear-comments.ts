import { isDeepStrictEqual } from 'node:util';
import {
  createApprovalRequest,
  createApprovalDecision,
  validateLinearCommentUrl,
} from '../approvals/domain.js';
import type { Approval } from '../approvals/domain.js';
import type { Event } from '../events/domain.js';
import type { AuditEntry } from './domain.js';
export function buildLinearCommentAudit(
  events: readonly Event[],
  approvals: readonly Approval[],
): readonly AuditEntry[] {
  const originals = new Map(events.map((event) => [event.id, event]));
  const decisions = new Map(approvals.map((approval) => [approval.request.id, approval]));
  return events
    .filter(
      (event) =>
        event.source === 'linear:host' &&
        ['linear.comment.claimed', 'linear.comment.created', 'linear.comment.unconfirmed'].includes(
          event.type,
        ),
    )
    .map((event) => {
      const claimId = event.payload.claimId;
      if (typeof claimId !== 'string') throw new Error('Linear comment Audit claim missing');
      const claim = originals.get(claimId);
      if (
        !claim ||
        claim.type !== 'linear.comment.claimed' ||
        claim.source !== event.source ||
        typeof claim.payload.approvalId !== 'string'
      )
        throw new Error('Linear comment Audit claim mismatch');
      const approval = decisions.get(claim.payload.approvalId);
      if (!approval || !approval.decision || approval.decision.decision !== 'approve')
        throw new Error('Linear comment Audit Approval missing');
      const { request, decision } = approval;
      createApprovalRequest(request, request);
      createApprovalDecision(request, decision, decision.createdAt);
      const operation = request.operation;
      if (
        operation.kind !== 'linear_comment' ||
        decision.approvalId !== request.id ||
        claim.id !== `linear-comment:${operation.commentId}`
      )
        throw new Error('Linear comment Audit operation mismatch');
      const payload = {
        claimId,
        approvalId: request.id,
        actorKind: request.actor.kind,
        actorId: request.actor.id,
        taskId: request.taskId,
        operation: { ...operation },
      };
      if (!isDeepStrictEqual(claim.payload, payload))
        throw new Error('Linear comment Audit context mismatch');
      let result: AuditEntry['result'] = 'started';
      let outputRef = `org://events/${encodeURIComponent(event.id)}`;
      let expectedId = claimId;
      if (event.type === 'linear.comment.created') {
        result = 'succeeded';
        expectedId += ':created';
        const commentUrl = validateLinearCommentUrl(operation, event.payload.commentUrl);
        if (!isDeepStrictEqual(event.payload, { ...payload, commentUrl }))
          throw new Error('Linear comment Audit success mismatch');
        outputRef = commentUrl;
      } else if (event.type === 'linear.comment.unconfirmed') {
        result = 'unconfirmed';
        expectedId += ':unconfirmed';
        if (!isDeepStrictEqual(event.payload, payload))
          throw new Error('Linear comment Audit uncertainty mismatch');
      }
      if (event.id !== expectedId) throw new Error('Linear comment Audit receipt ID mismatch');
      return {
        id: 'linear-comment:' + event.id,
        causalId: claimId,
        actor: request.actor,
        taskId: request.taskId,
        eventId: null,
        tool: 'linear.comment',
        inputRef:
          event.type === 'linear.comment.claimed'
            ? `org://linear-comment-inputs/${operation.inputDigest}`
            : `org://events/${encodeURIComponent(claimId)}`,
        outputRef,
        at: event.createdAt,
        result,
        approvalId: request.id,
      };
    });
}
