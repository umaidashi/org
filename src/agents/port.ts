import type { Agent } from './domain.js';

export interface AgentRepository {
  insert(agent: Agent): void;
  list(): readonly Agent[];
}
export interface AgentReportingWriter {
  setReportsTo(id: string, manager: string | null, at: string): Agent;
}
export interface ReportingHistory {
  readonly sequence: number;
  readonly agentId: string;
  readonly previousManager: string | null;
  readonly manager: string | null;
  readonly at: string;
}
