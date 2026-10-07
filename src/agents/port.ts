import type { Agent } from './domain.js';
import type { AuditActor, AuditEntry } from '../audit/domain.js';

export interface AgentRepository {
  insert(agent: Agent, actor?: AuditActor): void;
  list(): readonly Agent[];
}
export interface AgentReportingWriter {
  setReportsTo(id: string, manager: string | null, at: string, actor?: AuditActor): Agent;
}
export interface ReportingHistory {
  readonly sequence: number;
  readonly agentId: string;
  readonly previousManager: string | null;
  readonly manager: string | null;
  readonly at: string;
}

export interface AgentPermissionWriter {
  capabilitySnapshot(id: string): import('./permissions.js').CapabilitySnapshot;
  applyCapabilities(
    approved: import('../approvals/domain.js').ApprovedPermission,
    actor: import('../rooms/domain.js').Participant,
    at: string,
  ): import('./permissions.js').CapabilityChange;
  capabilityHistory(id?: string): readonly import('./permissions.js').CapabilityChange[];
}

export interface AgentConfigurationReader {
  configurationHistory(): readonly AuditEntry[];
}
