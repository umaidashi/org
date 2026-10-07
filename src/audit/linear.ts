import { createHash } from 'node:crypto';
import { linearClaimPayload } from '../linear/operation.js';
import { isDeepStrictEqual } from 'node:util';
import {
  createApprovalRequest,
  createApprovalDecision,
  validateLinearIssueReferenceUrl,
  validateLinearUpdatedIssueUrl,
  validateLinearArtifactUri,
} from '../approvals/domain.js';
import type { Approval } from '../approvals/domain.js';
import type { Event } from '../events/domain.js';
import type { AuditEntry } from './domain.js';
export function buildLinearAudit(
  events: readonly Event[],
  approvals: readonly Approval[],
): readonly AuditEntry[] {
  const originals = new Map(events.map((event) => [event.id, event]));
  const decisions = new Map(approvals.map((approval) => [approval.request.id, approval]));
  return events
    .filter(
      (event) =>
        event.source === 'linear:host' &&
        [
          'linear.comment.claimed',
          'linear.comment.created',
          'linear.comment.unconfirmed',
          'linear.artifact.claimed',
          'linear.artifact.linked',
          'linear.artifact.unconfirmed',
          'linear.update.claimed',
          'linear.update.updated',
          'linear.update.observed',
          'linear.update.unconfirmed',
        ].includes(event.type),
    )
    .map((event) => {
      const claimId = event.payload.claimId;
      if (typeof claimId !== 'string') throw new Error('Linear comment Audit claim missing');
      const claim = originals.get(claimId);
      if (
        !claim ||
        !['linear.comment.claimed', 'linear.artifact.claimed', 'linear.update.claimed'].includes(
          claim.type,
        ) ||
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
        (operation.kind !== 'linear_comment' &&
          operation.kind !== 'linear_artifact_link' &&
          operation.kind !== 'linear_issue_update') ||
        decision.approvalId !== request.id
      )
        throw new Error('Linear Audit operation mismatch');
      const payload = linearClaimPayload({ ...request, operation });
      const prefix =
        operation.kind === 'linear_comment'
          ? 'linear.comment'
          : operation.kind === 'linear_artifact_link'
            ? 'linear.artifact'
            : 'linear.update';
      if (claim.id !== payload.claimId || claim.type !== prefix + '.claimed')
        throw new Error('Linear Audit operation mismatch');
      if (!isDeepStrictEqual(claim.payload, payload))
        throw new Error('Linear comment Audit context mismatch');
      let result: AuditEntry['result'] = 'started';
      let outputRef = `org://events/${encodeURIComponent(event.id)}`;
      let expectedId = claimId;
      if (event.type === 'linear.comment.created') {
        if (operation.kind !== 'linear_comment') throw new Error('Linear Audit operation mismatch');
        result = 'succeeded';
        expectedId += ':created';
        const commentUrl = validateLinearIssueReferenceUrl(operation, event.payload.commentUrl);
        if (!isDeepStrictEqual(event.payload, { ...payload, commentUrl }))
          throw new Error('Linear comment Audit success mismatch');
        outputRef = commentUrl;
      } else if (event.type === 'linear.artifact.linked') {
        if (operation.kind !== 'linear_artifact_link')
          throw new Error('Linear Audit operation mismatch');
        result = 'succeeded';
        expectedId += ':linked';
        const artifactUri = validateLinearArtifactUri(event.payload.artifactUri),
          attachmentId = event.payload.attachmentId;
        if (
          typeof attachmentId !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attachmentId) ||
          createHash('sha256').update(artifactUri).digest('hex') !== operation.artifactUriDigest ||
          !isDeepStrictEqual(event.payload, { ...payload, attachmentId, artifactUri })
        )
          throw new Error('Linear Audit Artifact mismatch');
        outputRef = artifactUri;
      } else if (
        event.type === 'linear.update.updated' ||
        event.type === 'linear.update.observed'
      ) {
        if (operation.kind !== 'linear_issue_update')
          throw new Error('Linear Audit operation mismatch');
        const issueUrl = validateLinearUpdatedIssueUrl(operation, event.payload.issueUrl);
        if (
          !isDeepStrictEqual(event.payload, {
            ...payload,
            issueUrl,
            outputDigest: operation.inputDigest,
          })
        )
          throw new Error('Linear Audit update mismatch');
        result = event.type === 'linear.update.updated' ? 'succeeded' : 'observed';
        expectedId += event.type === 'linear.update.updated' ? ':updated' : ':observed';
        outputRef = issueUrl;
      } else if (event.type === prefix + '.unconfirmed') {
        result = 'unconfirmed';
        expectedId += ':unconfirmed';
        if (!isDeepStrictEqual(event.payload, payload))
          throw new Error('Linear comment Audit uncertainty mismatch');
      }
      if (event.id !== expectedId) throw new Error('Linear comment Audit receipt ID mismatch');
      return {
        id: prefix + ':' + event.id,
        causalId: claimId,
        actor: request.actor,
        taskId: request.taskId,
        eventId: null,
        tool: prefix,
        inputRef:
          event.type === prefix + '.claimed'
            ? `org://${prefix.replace('.', '-')}-inputs/${operation.inputDigest}`
            : `org://events/${encodeURIComponent(claimId)}`,
        outputRef,
        at: event.createdAt,
        result,
        approvalId: request.id,
      };
    });
}
