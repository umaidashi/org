import type { ApprovalStore } from './port.js';
import { requireApprovedPermission } from './domain.js';
import type { AgentPermissionWriter } from '../agents/port.js';
import type { CapabilityChange } from '../agents/permissions.js';
import type { Participant } from '../rooms/domain.js';
export function applyPermissionApproval(
  store: Pick<ApprovalStore, 'get'>,
  agents: Pick<AgentPermissionWriter, 'applyCapabilities'>,
  id: string,
  actor: Participant,
  at: string,
): CapabilityChange {
  return agents.applyCapabilities(requireApprovedPermission(store.get(id)), actor, at);
}
