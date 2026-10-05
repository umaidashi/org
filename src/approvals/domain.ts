import { validateCapabilities, type Capability } from '../agents/domain.js';
import type { Participant } from '../rooms/domain.js';
export interface PermissionOperation {
  readonly kind: 'agent_capabilities';
  readonly agentId: string;
  readonly expectedRevision: number;
  readonly capabilities: readonly Capability[];
}
export interface ApprovalRequestInput {
  readonly key: string;
  readonly actor: Participant;
  readonly taskId: string | null;
  readonly eventId: string | null;
  readonly operation: PermissionOperation;
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
  readonly request: ApprovalRequest;
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
export function createApprovalRequest(
  input: ApprovalRequestInput,
  identity: { readonly id: string; readonly createdAt: string },
): ApprovalRequest {
  for (const value of [input.key, identity.id, identity.createdAt, input.operation.agentId])
    text(value);
  for (const ref of [input.taskId, input.eventId]) if (ref !== null) text(ref);
  if (input.operation.kind !== 'agent_capabilities') throw new Error('Invalid Approval operation');
  if (
    !Number.isSafeInteger(input.operation.expectedRevision) ||
    input.operation.expectedRevision < 0
  )
    throw new Error('Invalid permission revision');
  return {
    ...input,
    ...identity,
    actor: actor(input.actor),
    operation: {
      ...input.operation,
      capabilities: validateCapabilities(input.operation.capabilities),
    },
  };
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
  if (approver.kind !== 'human') throw new Error('Permission change requires human approval');
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
  return { request, decision };
}
