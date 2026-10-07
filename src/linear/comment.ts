import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, createApprovalDecision } from '../approvals/domain.js';
import { validateLinearCommentUrl } from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { SecretStore } from '../secrets/port.js';
import type { EventBus } from '../events/port.js';
import { createEvent, type Identity } from '../events/domain.js';
import { linearWorkItemIssueId } from './import.js';
import { queryLinear } from './read.js';

export interface LinearCommentInput {
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly actor: string;
  readonly body: string;
}
export function linearCommentDigest(body: string): string {
  if (
    typeof body !== 'string' ||
    !body.trim() ||
    body.includes('\0') ||
    Buffer.byteLength(body) > 32768
  )
    throw new Error('Invalid Linear comment body');
  return createHash('sha256').update(body).digest('hex');
}
function snapshot(tasks: Pick<TaskProvider, 'get'>, input: LinearCommentInput) {
  const issueId = linearWorkItemIssueId(input.taskId);
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    typeof input.actor !== 'string' ||
    !input.actor.trim() ||
    input.actor.includes('\0') ||
    input.actor.length > 128
  )
    throw new Error('Invalid Linear comment input');
  const task = tasks.get(input.taskId);
  if (
    task.id !== input.taskId ||
    task.kind !== 'work_item' ||
    task.version !== input.expectedVersion ||
    !task.externalRef
  )
    throw new Error('Linear comment requires current imported WorkItem');
  return {
    issueId,
    issueUrl: task.externalRef,
    taskVersion: task.version,
    inputDigest: linearCommentDigest(input.body),
  };
}
export function requestLinearCommentApproval(
  tasks: Pick<TaskProvider, 'get'>,
  approvals: Pick<ApprovalStore, 'requestOnce' | 'list'>,
  input: LinearCommentInput & { readonly key: string },
  identity: Identity,
) {
  const fields = snapshot(tasks, input);
  // ponytail: reuse the stored UUID; concurrent first requests can conflict, then retry the same key to read the winner.
  const existing = approvals.list().find((approval) => approval.request.key === input.key)?.request;
  if (existing && existing.operation.kind !== 'linear_comment')
    throw new Error('Approval idempotency conflict');
  const commentId =
    existing?.operation.kind === 'linear_comment' ? existing.operation.commentId : identity.id;
  return approvals.requestOnce(
    createApprovalRequest(
      {
        key: input.key,
        actor: { kind: 'human', id: input.actor },
        taskId: input.taskId,
        eventId: null,
        operation: { kind: 'linear_comment', ...fields, commentId },
      },
      identity,
    ),
  );
}
export async function applyApprovedLinearComment(
  tasks: Pick<TaskProvider, 'get'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: LinearCommentInput & { readonly approvalId: string },
  now: () => string,
) {
  const fields = snapshot(tasks, input);
  const approval = approvals.get(input.approvalId),
    { request: original, decision } = approval;
  createApprovalRequest(original, original);
  if (!decision || decision.decision !== 'approve')
    throw new Error('Linear comment must be approved');
  createApprovalDecision(original, decision, decision.createdAt);
  const operation = original.operation;
  if (
    original.id !== input.approvalId ||
    decision.approvalId !== original.id ||
    operation.kind !== 'linear_comment' ||
    !isDeepStrictEqual(original.actor, { kind: 'human', id: input.actor }) ||
    original.taskId !== input.taskId ||
    !isDeepStrictEqual(operation, {
      kind: 'linear_comment',
      ...fields,
      commentId: operation.commentId,
    })
  )
    throw new Error('Linear comment Approval does not match input');
  const claimId = `linear-comment:${operation.commentId}`;
  // ponytail: scan immutable receipts; add an indexed existence query if measured log volume warrants it.
  if (events.list().some((event) => event.id === claimId))
    throw new Error('Linear comment already claimed; do not retry POST');
  const payload = {
    claimId,
    approvalId: original.id,
    actorKind: 'human',
    actorId: input.actor,
    taskId: input.taskId,
    operation: { ...operation },
  };
  const publish = (type: string, id: string, commentUrl?: string) =>
    events.publish(
      createEvent(
        {
          type,
          source: 'linear:host',
          payload: { ...payload, ...(commentUrl === undefined ? {} : { commentUrl }) },
        },
        { id, createdAt: now() },
      ),
    );
  let claimed = false;
  try {
    const data = await queryLinear(
      request,
      secrets,
      'mutation KernelComment($issueId: String!, $body: String!, $id: String!) { commentCreate(input: { issueId: $issueId, body: $body, id: $id }) { success comment { id body url issue { id } } } }',
      { issueId: operation.issueId, body: input.body, id: operation.commentId },
      {
        reference: 'linear:write',
        beforeRequest: () => {
          if (!isDeepStrictEqual(snapshot(tasks, input), fields))
            throw new Error('Linear WorkItem changed before comment');
          publish('linear.comment.claimed', claimId);
          claimed = true;
        },
      },
    );
    const result = data.commentCreate;
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !('success' in result) ||
      result.success !== true ||
      !('comment' in result)
    )
      throw new Error('Invalid Linear comment response');
    const comment = result.comment;
    if (
      !comment ||
      typeof comment !== 'object' ||
      Array.isArray(comment) ||
      !('id' in comment) ||
      comment.id !== operation.commentId ||
      !('body' in comment) ||
      comment.body !== input.body ||
      !('issue' in comment) ||
      !comment.issue ||
      typeof comment.issue !== 'object' ||
      !('id' in comment.issue) ||
      comment.issue.id !== operation.issueId ||
      !('url' in comment)
    )
      throw new Error('Invalid Linear comment response');
    return publish(
      'linear.comment.created',
      claimId + ':created',
      validateLinearCommentUrl(operation, comment.url),
    );
  } catch (error) {
    if (claimed) {
      try {
        publish('linear.comment.unconfirmed', claimId + ':unconfirmed');
      } catch (failure) {
        throw new AggregateError(
          [error, failure],
          'Linear comment failed and uncertainty could not be recorded',
        );
      }
    }
    throw error;
  }
}
