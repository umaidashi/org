import { validateCapabilities, type Capability } from './domain.js';
import { requireApprovedPermission, type ApprovedPermission } from '../approvals/domain.js';
import type { Participant } from '../rooms/domain.js';
export interface CapabilitySnapshot {
  readonly agentId: string;
  readonly revision: number;
  readonly capabilities: readonly Capability[];
}
export interface CapabilityChange extends CapabilitySnapshot {
  readonly approvalId: string;
  readonly previousCapabilities: readonly Capability[];
  readonly actor: Participant;
  readonly taskId: string | null;
  readonly eventId: string | null;
  readonly tool: 'agent.capabilities.change';
  readonly inputRef: string;
  readonly outputRef: string;
  readonly at: string;
  readonly result: 'applied';
}
export function createCapabilityChange(
  snapshot: CapabilitySnapshot,
  approved: ApprovedPermission,
  actor: Participant,
  at: string,
): CapabilityChange {
  requireApprovedPermission(approved);
  const operation = approved.request.operation;
  if (snapshot.agentId !== operation.agentId) throw new Error('Approval targets another Agent');
  if (
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    snapshot.revision !== operation.expectedRevision ||
    snapshot.revision >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('Permission revision conflict');
  if ((actor.kind !== 'human' && actor.kind !== 'agent') || !actor.id.trim() || !at.trim())
    throw new Error('Invalid permission Audit actor/timestamp');
  if (
    actor.kind === 'agent' &&
    (approved.request.actor.kind !== 'agent' || approved.request.actor.id !== actor.id)
  )
    throw new Error('Permission executor must match requesting Agent');
  return {
    agentId: snapshot.agentId,
    revision: snapshot.revision + 1,
    capabilities: validateCapabilities(operation.capabilities),
    previousCapabilities: validateCapabilities(snapshot.capabilities),
    approvalId: approved.request.id,
    actor: { ...actor },
    taskId: approved.request.taskId,
    eventId: approved.request.eventId,
    tool: 'agent.capabilities.change',
    inputRef: `org://approvals/${encodeURIComponent(approved.request.id)}`,
    outputRef: `org://agents/${encodeURIComponent(snapshot.agentId)}/capabilities/${snapshot.revision + 1}`,
    at,
    result: 'applied',
  };
}
