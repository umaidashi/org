import {
  createAgent,
  changeReportingLine,
  type Agent,
  type AgentInput,
  type Identity,
} from './domain.js';
import type { AgentRepository, AgentReportingWriter } from './port.js';

export function setReportingLine(
  repository: Pick<AgentRepository, 'list'> & AgentReportingWriter,
  id: string,
  manager: string | null,
  at: string,
): Agent {
  changeReportingLine(repository.list(), id, manager);
  return repository.setReportsTo(id, manager, at);
}

export function registerAgent(
  repository: Pick<AgentRepository, 'insert'>,
  input: AgentInput,
  identity: Identity,
): Agent {
  const agent = createAgent(input, identity);
  repository.insert(agent);
  return agent;
}
