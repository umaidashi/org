import { createAgent, type Agent, type AgentInput, type Identity } from './domain.js';
import type { AgentRepository } from './port.js';

export function registerAgent(
  repository: Pick<AgentRepository, 'insert'>,
  input: AgentInput,
  identity: Identity,
): Agent {
  const agent = createAgent(input, identity);
  repository.insert(agent);
  return agent;
}
