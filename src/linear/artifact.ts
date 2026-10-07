import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  createApprovalRequest,
  validateLinearArtifactUri,
  type ApprovalRequest,
  type LinearArtifactLinkOperation,
} from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { EventBus } from '../events/port.js';
import type { SecretStore } from '../secrets/port.js';
import { createEvent, type Identity, type Event } from '../events/domain.js';
import { linearWorkItemIssueId } from './import.js';
import { queryLinear } from './read.js';
import {
  requireApprovedLinearRequest,
  linearClaimPayload,
  publishVerifiedLinearReceipt,
} from './operation.js';
export interface LinearArtifactInput {
  readonly taskId: string;
  readonly artifactId: string;
  readonly title: string;
  readonly expectedVersion: number;
  readonly actor: string;
}
export function validateLinearArtifactInput(input: LinearArtifactInput): void {
  linearWorkItemIssueId(input.taskId);
  for (const value of [input.artifactId, input.actor])
    if (typeof value !== 'string' || !value.trim() || value.length > 128 || value.includes('\0'))
      throw new Error('Invalid Linear Artifact input');
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    Buffer.byteLength(input.title) > 512 ||
    input.title.includes('\0')
  )
    throw new Error('Invalid Linear Artifact input');
}
function snapshot(tasks: Pick<TaskProvider, 'get' | 'artifacts'>, input: LinearArtifactInput) {
  validateLinearArtifactInput(input);
  const task = tasks.get(input.taskId);
  if (
    task.id !== input.taskId ||
    task.kind !== 'work_item' ||
    !task.externalRef ||
    task.version !== input.expectedVersion ||
    !task.outputArtifacts.includes(input.artifactId)
  )
    throw new Error('Linear Artifact requires current WorkItem output');
  const artifact = tasks.artifacts(input.taskId).find((a) => a.id === input.artifactId);
  if (!artifact) throw new Error('Linear Artifact original missing');
  const uri = validateLinearArtifactUri(artifact.uri);
  return {
    uri,
    operation: {
      kind: 'linear_artifact_link' as const,
      issueId: linearWorkItemIssueId(input.taskId),
      issueUrl: task.externalRef,
      taskVersion: task.version,
      artifactId: artifact.id,
      artifactUriDigest: createHash('sha256').update(uri).digest('hex'),
      inputDigest: createHash('sha256')
        .update(JSON.stringify({ artifactId: artifact.id, uri, title: input.title }))
        .digest('hex'),
    },
  };
}
export function requestLinearArtifactApproval(
  tasks: Pick<TaskProvider, 'get' | 'artifacts'>,
  approvals: Pick<ApprovalStore, 'requestOnce'>,
  input: LinearArtifactInput & { readonly key: string },
  identity: Identity,
) {
  const { operation } = snapshot(tasks, input);
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
export async function applyApprovedLinearArtifact(
  tasks: Pick<TaskProvider, 'get' | 'artifacts'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: LinearArtifactInput & { readonly approvalId: string },
  now: () => string,
) {
  const fields = snapshot(tasks, input),
    original = requireApprovedLinearRequest(approvals, input);
  if (
    original.operation.kind !== 'linear_artifact_link' ||
    !isDeepStrictEqual(original.operation, fields.operation)
  )
    throw new Error('Linear Artifact Approval does not match input');
  const payload = linearClaimPayload({ ...original, operation: original.operation });
  if (events.list().some((e) => e.id === payload.claimId))
    throw new Error('Linear Artifact already claimed; do not retry mutation');
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
      'mutation KernelArtifact($issueId: String!, $title: String!, $url: String!) { attachmentCreate(input: { issueId: $issueId, title: $title, url: $url }) { success attachment { id title url issue { id } } } }',
      { issueId: fields.operation.issueId, title: input.title, url: fields.uri },
      {
        reference: 'linear:write',
        beforeRequest: () => {
          if (!isDeepStrictEqual(snapshot(tasks, input), fields))
            throw new Error('Linear Artifact changed before request');
          events.publish(receipt('linear.artifact.claimed', ''));
          claimed = true;
        },
      },
    );
    const result = data.attachmentCreate;
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !('success' in result) ||
      result.success !== true ||
      !('attachment' in result)
    )
      throw new Error('Invalid Linear Artifact response');
    return saveLinkedArtifact(
      events,
      { ...original, operation: original.operation },
      fields.uri,
      verifiedAttachment(result.attachment, fields.operation, input.title, fields.uri),
      now,
    );
  } catch (error) {
    if (claimed) {
      try {
        events.publish(receipt('linear.artifact.unconfirmed', ':unconfirmed'));
      } catch (failure) {
        throw new AggregateError(
          [error, failure],
          'Linear Artifact failed and uncertainty could not be recorded',
        );
      }
    }
    throw error;
  }
}
function verifiedAttachment(
  attachment: unknown,
  operation: LinearArtifactLinkOperation,
  title: string,
  uri: string,
): string {
  if (
    !attachment ||
    typeof attachment !== 'object' ||
    Array.isArray(attachment) ||
    !('id' in attachment) ||
    typeof attachment.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attachment.id) ||
    !('title' in attachment) ||
    attachment.title !== title ||
    !('url' in attachment) ||
    attachment.url !== uri ||
    !('issue' in attachment) ||
    !attachment.issue ||
    typeof attachment.issue !== 'object' ||
    !('id' in attachment.issue) ||
    attachment.issue.id !== operation.issueId
  )
    throw new Error('Invalid Linear Artifact response');
  return attachment.id;
}
function saveLinkedArtifact(
  events: Pick<EventBus, 'list' | 'publish'>,
  original: ApprovalRequest & { readonly operation: LinearArtifactLinkOperation },
  uri: string,
  attachmentId: string,
  now: () => string,
): Event {
  const payload = linearClaimPayload(original);
  return publishVerifiedLinearReceipt(
    events,
    createEvent(
      {
        type: 'linear.artifact.linked',
        source: 'linear:host',
        payload: { ...payload, attachmentId, artifactUri: uri },
      },
      { id: payload.claimId + ':linked', createdAt: now() },
    ),
  );
}

export async function observeApprovedLinearArtifact(
  tasks: Pick<TaskProvider, 'get' | 'artifacts'>,
  approvals: Pick<ApprovalStore, 'get'>,
  events: Pick<EventBus, 'list' | 'publish'>,
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: {
    readonly taskId: string;
    readonly title: string;
    readonly actor: string;
    readonly approvalId: string;
  },
  now: () => string,
): Promise<Event> {
  const approved = requireApprovedLinearRequest(approvals, input);
  if (approved.operation.kind !== 'linear_artifact_link')
    throw new Error('Linear Artifact Approval does not match input');
  const original = { ...approved, operation: approved.operation };
  const fields = () => {
    const current = snapshot(tasks, {
      ...input,
      artifactId: original.operation.artifactId,
      expectedVersion: tasks.get(input.taskId).version,
    });
    if (
      !isDeepStrictEqual(
        { ...current.operation, taskVersion: original.operation.taskVersion },
        original.operation,
      )
    )
      throw new Error('Linear Artifact target or input changed');
    return current;
  };
  const pinned = fields(),
    payload = linearClaimPayload(original),
    receipts = events.list();
  const claim = receipts.find((e) => e.id === payload.claimId);
  if (
    !claim ||
    claim.type !== 'linear.artifact.claimed' ||
    claim.source !== 'linear:host' ||
    !isDeepStrictEqual(claim.payload, payload)
  )
    throw new Error('Linear Artifact claim missing or mismatched');
  const known = receipts.find((e) => e.id === payload.claimId + ':linked');
  if (known) {
    if (
      known.type !== 'linear.artifact.linked' ||
      known.source !== 'linear:host' ||
      typeof known.payload.attachmentId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        known.payload.attachmentId,
      ) ||
      !isDeepStrictEqual(known.payload, {
        ...payload,
        attachmentId: known.payload.attachmentId,
        artifactUri: pinned.uri,
      })
    )
      throw new Error('Linear Artifact receipt mismatch');
    return known;
  }
  const data = await queryLinear(
    request,
    secrets,
    'query KernelArtifactStatus($issueId: String!, $url: String!) { issue(id: $issueId) { id attachments(filter: { url: { eq: $url } }, first: 2) { nodes { id title url issue { id } } pageInfo { hasNextPage } } } }',
    { issueId: original.operation.issueId, url: pinned.uri },
  );
  const issue = data.issue;
  if (
    !issue ||
    typeof issue !== 'object' ||
    !('id' in issue) ||
    issue.id !== original.operation.issueId ||
    !('attachments' in issue)
  )
    throw new Error('Invalid Linear Artifact status');
  const connection = issue.attachments;
  if (
    !connection ||
    typeof connection !== 'object' ||
    !('nodes' in connection) ||
    !Array.isArray(connection.nodes) ||
    connection.nodes.length !== 1 ||
    !('pageInfo' in connection) ||
    !connection.pageInfo ||
    typeof connection.pageInfo !== 'object' ||
    !('hasNextPage' in connection.pageInfo) ||
    connection.pageInfo.hasNextPage !== false
  )
    throw new Error('Linear Artifact status missing or ambiguous');
  const attachment: unknown = connection.nodes[0];
  const attachmentId = verifiedAttachment(attachment, original.operation, input.title, pinned.uri);
  fields();
  return saveLinkedArtifact(events, original, pinned.uri, attachmentId, now);
}
