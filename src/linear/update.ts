import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, validateLinearUpdatedIssueUrl } from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { EventBus } from '../events/port.js';
import type { SecretStore } from '../secrets/port.js';
import { createEvent, type Identity } from '../events/domain.js';
import { linearWorkItemIssueId } from './import.js';
import { queryLinear } from './read.js';
import {
  readLinearUpdateIssue,
  parseLinearUpdateIssue,
  parseLinearIssueFields,
  linearIssueFieldSelection,
  type LinearIssueFields,
  type LinearUpdateIssue,
} from './fields.js';
import { parseLinearIssueFieldMask } from '../approvals/domain.js';
import {
  requireApprovedLinearRequest,
  linearClaimPayload,
  publishVerifiedLinearReceipt,
} from './operation.js';
interface LinearUpdateTargetInput {
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly actor: string;
}
export type LinearUpdateInput = LinearUpdateTargetInput &
  (
    | { readonly title: string; readonly description: string; readonly fields?: never }
    | { readonly fields: LinearIssueFields; readonly title?: never; readonly description?: never }
  );
function changes(input: LinearUpdateInput) {
  return input.fields === undefined
    ? { title: input.title, description: input.description }
    : parseLinearIssueFields(input.fields);
}
function outputChanges(issue: LinearUpdateIssue) {
  return issue.fields ?? { title: issue.title, description: issue.description };
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
    (input.fields === undefined
      ? typeof input.title !== 'string' ||
        !input.title.trim() ||
        Buffer.byteLength(input.title) > 512 ||
        input.title.includes('\0') ||
        typeof input.description !== 'string' ||
        Buffer.byteLength(input.description) > 32768 ||
        input.description.includes('\0')
      : input.title !== undefined || input.description !== undefined)
  )
    throw new Error('Invalid Linear Issue update input');
  if (input.fields !== undefined) parseLinearIssueFields(input.fields);
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
    inputDigest: digest(changes(input)),
    ...(input.fields === undefined
      ? {}
      : { fields: parseLinearIssueFieldMask(Object.keys(parseLinearIssueFields(input.fields))) }),
  };
}
function baseline(issue: LinearUpdateIssue): string {
  return digest({
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    ...(issue.fields
      ? { fields: issue.fields }
      : { title: issue.title, description: issue.description }),
  });
}
export async function prepareLinearUpdateOperation(
  tasks: Pick<TaskProvider, 'get'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: LinearUpdateInput,
) {
  const original = target(tasks, input);
  const issue = await readLinearUpdateIssue(request, secrets, original.issueId, original.fields);
  validateLinearUpdatedIssueUrl(original, issue.url);
  if (!isDeepStrictEqual(target(tasks, input), original))
    throw new Error('Linear Issue update target changed');
  return { ...original, baselineDigest: baseline(issue) };
}
export async function requestLinearUpdateApproval(
  tasks: Pick<TaskProvider, 'get'>,
  approvals: Pick<ApprovalStore, 'requestOnce'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: LinearUpdateInput & { readonly key: string },
  identity: Identity,
) {
  const operation = await prepareLinearUpdateOperation(tasks, secrets, request, input);
  return approvals.requestOnce(
    createApprovalRequest(
      {
        key: input.key,
        actor: { kind: 'human', id: input.actor },
        taskId: input.taskId,
        eventId: null,
        operation,
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
  const issue = await readLinearUpdateIssue(
    request,
    secrets,
    original.operation.issueId,
    original.operation.fields,
  );
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
      original.operation.fields
        ? 'mutation KernelIssueFieldsUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title description url ' +
            linearIssueFieldSelection(original.operation.fields) +
            ' } } }'
        : 'mutation KernelIssueUpdate($id: String!, $title: String!, $description: String!) { issueUpdate(id: $id, input: { title: $title, description: $description }) { success issue { id identifier title description url } } }',
      original.operation.fields
        ? { id: original.operation.issueId, input: changes(input) }
        : { id: original.operation.issueId, title: input.title, description: input.description },
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
    const updated = parseLinearUpdateIssue(result.issue, original.operation.fields);
    if (
      updated.id !== original.operation.issueId ||
      updated.identifier !== issue.identifier ||
      digest(outputChanges(updated)) !== original.operation.inputDigest
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
            outputDigest: digest(outputChanges(updated)),
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

export async function observeApprovedLinearUpdate(
  tasks: Pick<TaskProvider, 'get'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: { readonly taskId: string; readonly actor: string; readonly approvalId: string },
  now: () => string,
) {
  const approved = requireApprovedLinearRequest(approvals, input);
  if (approved.operation.kind !== 'linear_issue_update')
    throw new Error('Linear Issue update Approval does not match input');
  const original = { ...approved, operation: approved.operation },
    operation = original.operation;
  const validateTarget = () => {
    const task = tasks.get(input.taskId);
    if (
      linearWorkItemIssueId(input.taskId) !== operation.issueId ||
      task.id !== input.taskId ||
      task.kind !== 'work_item' ||
      task.externalRef !== operation.issueUrl
    )
      throw new Error('Linear Issue update target changed');
  };
  validateTarget();
  const payload = linearClaimPayload(original),
    receipts = events.list(),
    claim = receipts.find((event) => event.id === payload.claimId);
  if (
    !claim ||
    claim.type !== 'linear.update.claimed' ||
    claim.source !== 'linear:host' ||
    !isDeepStrictEqual(claim.payload, payload)
  )
    throw new Error('Linear Issue update claim missing or mismatched');
  for (const suffix of ['updated', 'observed']) {
    const known = receipts.find((event) => event.id === payload.claimId + ':' + suffix);
    if (!known) continue;
    const issueUrl = validateLinearUpdatedIssueUrl(operation, known.payload.issueUrl);
    if (
      known.type !== 'linear.update.' + suffix ||
      known.source !== 'linear:host' ||
      !isDeepStrictEqual(known.payload, {
        ...payload,
        issueUrl,
        outputDigest: operation.inputDigest,
      })
    )
      throw new Error('Linear Issue update receipt mismatch');
    return known;
  }
  const issue = await readLinearUpdateIssue(request, secrets, operation.issueId, operation.fields),
    issueUrl = validateLinearUpdatedIssueUrl(operation, issue.url);
  if (digest(outputChanges(issue)) !== operation.inputDigest)
    throw new Error('Linear Issue current contents do not match approval');
  validateTarget();
  // ponytail: this is a point-in-time observation, not proof of which writer changed the Issue or ongoing synchronization.
  return publishVerifiedLinearReceipt(
    events,
    createEvent(
      {
        type: 'linear.update.observed',
        source: 'linear:host',
        payload: { ...payload, issueUrl, outputDigest: operation.inputDigest },
      },
      { id: payload.claimId + ':observed', createdAt: now() },
    ),
  );
}
