import { validateCapabilities, type Capability } from '../agents/domain.js';
import type { Participant } from '../rooms/domain.js';
export interface PermissionOperation {
  readonly kind: 'agent_capabilities';
  readonly agentId: string;
  readonly expectedRevision: number;
  readonly capabilities: readonly Capability[];
}
export interface TaskWorkflowBinding {
  readonly taskVersion: number;
  readonly proposalRef: string;
  readonly requiredCapabilities?: readonly Capability[];
}
export function parseTaskWorkflowBinding(value: unknown): TaskWorkflowBinding {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['taskVersion', 'proposalRef', 'requiredCapabilities'].includes(key),
    ) ||
    !('taskVersion' in value) ||
    typeof value.taskVersion !== 'number' ||
    !Number.isSafeInteger(value.taskVersion) ||
    value.taskVersion < 0 ||
    !('proposalRef' in value) ||
    typeof value.proposalRef !== 'string' ||
    value.proposalRef.length > 2048
  )
    throw new Error('Invalid Task Workflow binding');
  const match = /^org:\/\/rooms\/([^/]+)\/messages\/([^/]+)$/.exec(value.proposalRef);
  try {
    if (!match) throw new Error('Invalid reference');
    const room = decodeURIComponent(match[1] ?? ''),
      message = decodeURIComponent(match[2] ?? '');
    text(room);
    text(message);
    if (
      value.proposalRef !==
      `org://rooms/${encodeURIComponent(room)}/messages/${encodeURIComponent(message)}`
    )
      throw new Error('Invalid reference');
  } catch {
    throw new Error('Invalid Task Workflow proposal reference');
  }
  const required =
    'requiredCapabilities' in value ? validateCapabilities(value.requiredCapabilities) : [];
  return {
    taskVersion: value.taskVersion,
    proposalRef: value.proposalRef,
    ...(required.length ? { requiredCapabilities: required } : {}),
  };
}
export interface WorkflowOperation {
  readonly kind: 'workflow_invocation';
  readonly host: string;
  readonly workflowId: string;
  readonly inputDigest: string;
  readonly requestId: string;
  readonly effect: 'write' | 'irreversible';
  readonly binding?: TaskWorkflowBinding;
}
export interface ApprovalRequestInput {
  readonly key: string;
  readonly actor: Participant;
  readonly taskId: string | null;
  readonly eventId: string | null;
  readonly operation: PermissionOperation | WorkflowOperation;
}
export interface ApprovalRequest extends ApprovalRequestInput {
  readonly id: string;
  readonly createdAt: string;
}
export interface ApprovalDecisionInput {
  readonly actor: Participant;
  readonly decision: 'approve' | 'reject';
  readonly reason: string;
}
export interface ApprovalDecision extends ApprovalDecisionInput {
  readonly approvalId: string;
  readonly createdAt: string;
}
export interface Approval {
  readonly request: ApprovalRequest;
  readonly decision: ApprovalDecision | null;
}
export interface ApprovedPermission {
  readonly request: ApprovalRequest & { readonly operation: PermissionOperation };
  readonly decision: ApprovalDecision;
}
function text(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new Error('Approval fields must contain nonempty text');
}
function actor(value: Participant): Participant {
  if (value.kind !== 'human' && value.kind !== 'agent') throw new Error('Invalid Approval actor');
  text(value.id);
  return { ...value };
}
export function createApprovalRequest<T extends ApprovalRequestInput>(
  input: T,
  identity: { readonly id: string; readonly createdAt: string },
): ApprovalRequest & { readonly operation: T['operation'] };
export function createApprovalRequest(
  input: ApprovalRequestInput,
  identity: { readonly id: string; readonly createdAt: string },
): ApprovalRequest {
  for (const value of [input.key, identity.id, identity.createdAt]) text(value);
  for (const ref of [input.taskId, input.eventId]) if (ref !== null) text(ref);
  let operation: PermissionOperation | WorkflowOperation;
  if (input.operation.kind === 'agent_capabilities') {
    text(input.operation.agentId);
    if (
      !Number.isSafeInteger(input.operation.expectedRevision) ||
      input.operation.expectedRevision < 0
    )
      throw new Error('Invalid permission revision');
    operation = {
      ...input.operation,
      capabilities: validateCapabilities(input.operation.capabilities),
    };
  } else if (input.operation.kind === 'workflow_invocation') {
    const value = input.operation;
    if (
      Object.keys(value).some(
        (key) =>
          !['kind', 'host', 'workflowId', 'inputDigest', 'requestId', 'effect', 'binding'].includes(
            key,
          ),
      )
    )
      throw new Error('Invalid Workflow Approval operation');
    for (const field of [value.host, value.workflowId, value.requestId]) text(field);
    if (value.host.length > 2048 || value.workflowId.length > 128 || value.requestId.length > 128)
      throw new Error('Workflow Approval field size limit');
    if (typeof value.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputDigest))
      throw new Error('Invalid Workflow input digest');
    if (value.effect !== 'write' && value.effect !== 'irreversible')
      throw new Error('Invalid Workflow Approval effect');
    let host: URL;
    try {
      host = new URL(value.host);
    } catch {
      throw new Error('Invalid Workflow Approval host');
    }
    if (
      !['https:', 'http:'].includes(host.protocol) ||
      host.username ||
      host.password ||
      host.search ||
      host.hash ||
      host.toString().replace(/\/$/, '') !== value.host
    )
      throw new Error('Invalid Workflow Approval host');
    if (value.binding !== undefined && (input.actor.kind !== 'agent' || input.taskId === null))
      throw new Error('Task Workflow binding requires Agent and Task');
    operation = {
      ...(value.binding === undefined ? {} : { binding: parseTaskWorkflowBinding(value.binding) }),
      kind: value.kind,
      host: value.host,
      workflowId: value.workflowId,
      inputDigest: value.inputDigest,
      requestId: value.requestId,
      effect: value.effect,
    };
  } else throw new Error('Invalid Approval operation');
  return { ...input, ...identity, actor: actor(input.actor), operation };
}
export function createApprovalDecision(
  request: ApprovalRequest,
  input: ApprovalDecisionInput,
  createdAt: string,
): ApprovalDecision {
  text(request.id);
  text(input.reason);
  text(createdAt);
  const approver = actor(input.actor);
  if (approver.kind !== 'human') throw new Error('Operation requires human approval');
  if (input.decision !== 'approve' && input.decision !== 'reject')
    throw new Error('Invalid Approval decision');
  return { ...input, actor: approver, approvalId: request.id, createdAt };
}
export function requireApprovedPermission(approval: Approval): ApprovedPermission {
  const { request, decision } = approval;
  if (decision === null || decision.decision !== 'approve')
    throw new Error('Permission operation must be approved');
  if (decision.approvalId !== request.id)
    throw new Error('Approval decision does not match request');
  createApprovalRequest(request, request);
  createApprovalDecision(request, decision, decision.createdAt);
  if (request.operation.kind !== 'agent_capabilities')
    throw new Error('Approval is not a permission operation');
  return { request: { ...request, operation: request.operation }, decision };
}
