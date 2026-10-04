import type { Agent } from './domain.js';

export interface AgentRepository {
  insert(agent: Agent): void;
  list(): readonly Agent[];
}
