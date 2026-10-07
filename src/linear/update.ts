import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, validateLinearUpdatedIssueUrl } from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { EventBus } from '../events/port.js';
import type { SecretStore } from '../secrets/port.js';
import { createEvent, type Identity } from '../events/domain.js';
import { linearWorkItemIssueId } from './import.js';
import { readLinearIssue, queryLinear, parseLinearIssue, type LinearIssue } from './read.js';
import {
  requireApprovedLinearRequest,
  linearClaimPayload,
  publishVerifiedLinearReceipt,
} from './operation.js';
export interface LinearUpdateInput {
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly expectedVersion: number;
  readonly actor: string;
}
export function validateLinearUpdateInput(input: LinearUpdateInput): void {
  linearWorkItemIssueId(input.taskId);
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    typeof input.actor !== 'string' ||
    !input.actor.trim() ||
    input.actor.length > 128 ||
    input.actor.includes('\0') ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    Buffer.byteLength(input.title) > 512 ||
    input.title.includes('\0') ||
    typeof input.description !== 'string' ||
    Buffer.byteLength(input.description) > 32768 ||
    input.description.includes('\0')
  )
    throw new Error('Invalid Linear Issue update input');
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function target(tasks: Pick<TaskProvider, 'get'>, input: LinearUpdateInput) {
  validateLinearUpdateInput(input);
  const task = tasks.get(input.taskId);
  if (
    task.id !== input.taskId ||
    task.kind !== 'work_item' ||
    !task.externalRef ||
    task.version !== input.expectedVersion
  )
    throw new Error('Linear Issue update requires current WorkItem');
  return {
    kind: 'linear_issue_update' as const,
    issueId: linearWorkItemIssueId(input.taskId),
    issueUrl: task.externalRef,
    taskVersion: task.version,
    inputDigest: digest({ title: input.title, description: input.description }),
  };
}
function baseline(issue: LinearIssue): string {
  return digest({
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    title: issue.title,
    description: issue.description,
  });
}
export async function requestLinearUpdateApproval(
  tasks: Pick<TaskProvider, 'get'>,
  approvals: Pick<ApprovalStore, 'requestOnce'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: LinearUpdateInput & { readonly key: string },
  identity: Identity,
) {
  const original = target(tasks, input);
  const issue = await readLinearIssue(request, secrets, original.issueId);
  validateLinearUpdatedIssueUrl(original, issue.url);
  if (!isDeepStrictEqual(target(tasks, input), original))
    throw new Error('Linear Issue update target changed');
  return approvals.requestOnce(
    createApprovalRequest(
      {
        key: input.key,
        actor: { kind: 'human', id: input.actor },
        taskId: input.taskId,
        eventId: null,
        operation: { ...original, baselineDigest: baseline(issue) },
      },
      identity,
    ),
  );
}
export async function applyApprovedLinearUpdate(
  tasks: Pick<TaskProvider, 'get'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: LinearUpdateInput & { readonly approvalId: string },
  now: () => string,
) {
  const approved = requireApprovedLinearRequest(approvals, input),
    current = target(tasks, input);
  if (
    approved.operation.kind !== 'linear_issue_update' ||
    !isDeepStrictEqual(approved.operation, {
      ...current,
      baselineDigest: approved.operation.baselineDigest,
    })
  )
    throw new Error('Linear Issue update Approval does not match input');
  const original = { ...approved, operation: approved.operation },
    payload = linearClaimPayload(original);
  if (events.list().some((e) => e.id === payload.claimId))
    throw new Error('Linear Issue update already claimed; do not retry mutation');
  const issue = await readLinearIssue(request, secrets, original.operation.issueId);
  if (baseline(issue) !== original.operation.baselineDigest)
    throw new Error('Linear Issue baseline changed; request new approval');
  const receipt = (type: string, suffix: string) =>
    createEvent(
      { type, source: 'linear:host', payload },
      { id: payload.claimId + suffix, createdAt: now() },
    );
  let claimed = false;
  try {
    const data = await queryLinear(
      request,
      secrets,
      'mutation KernelIssueUpdate($id: String!, $title: String!, $description: String!) { issueUpdate(id: $id, input: { title: $title, description: $description }) { success issue { id identifier title description url } } }',
      { id: original.operation.issueId, title: input.title, description: input.description },
      {
        reference: 'linear:write',
        beforeRequest: () => {
          if (!isDeepStrictEqual(target(tasks, input), current))
            throw new Error('Linear Issue update target changed');
          events.publish(receipt('linear.update.claimed', ''));
          claimed = true;
        },
      },
    );
    const result = data.issueUpdate;
    if (
      !result ||
      typeof result !== 'object' ||
      !('success' in result) ||
      result.success !== true ||
      !('issue' in result)
    )
      throw new Error('Invalid Linear Issue update response');
    const updated = parseLinearIssue(result.issue);
    if (
      updated.id !== original.operation.issueId ||
      updated.identifier !== issue.identifier ||
      updated.title !== input.title ||
      updated.description !== input.description
    )
      throw new Error('Linear Issue update response mismatch');
    const issueUrl = validateLinearUpdatedIssueUrl(original.operation, updated.url);
    return publishVerifiedLinearReceipt(
      events,
      createEvent(
        {
          type: 'linear.update.updated',
          source: 'linear:host',
          payload: {
            ...payload,
            issueUrl,
            outputDigest: digest({ title: updated.title, description: updated.description }),
          },
        },
        { id: payload.claimId + ':updated', createdAt: now() },
      ),
    );
  } catch (error) {
    if (claimed) {
      try {
        events.publish(receipt('linear.update.unconfirmed', ':unconfirmed'));
      } catch (failure) {
        throw new AggregateError(
          [error, failure],
          'Linear Issue update failed and uncertainty could not be recorded',
        );
      }
    }
    throw error;
  }
}
