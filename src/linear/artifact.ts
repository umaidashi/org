import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, validateLinearArtifactUri } from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { EventBus } from '../events/port.js';
import type { SecretStore } from '../secrets/port.js';
import { createEvent, type Identity } from '../events/domain.js';
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
    const attachment = result.attachment;
    if (
      !attachment ||
      typeof attachment !== 'object' ||
      Array.isArray(attachment) ||
      !('id' in attachment) ||
      typeof attachment.id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attachment.id) ||
      !('title' in attachment) ||
      attachment.title !== input.title ||
      !('url' in attachment) ||
      attachment.url !== fields.uri ||
      !('issue' in attachment) ||
      !attachment.issue ||
      typeof attachment.issue !== 'object' ||
      !('id' in attachment.issue) ||
      attachment.issue.id !== fields.operation.issueId
    )
      throw new Error('Invalid Linear Artifact response');
    return publishVerifiedLinearReceipt(
      events,
      createEvent(
        {
          type: 'linear.artifact.linked',
          source: 'linear:host',
          payload: { ...payload, attachmentId: attachment.id, artifactUri: fields.uri },
        },
        { id: payload.claimId + ':linked', createdAt: now() },
      ),
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
