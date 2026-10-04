import type { AgentRepository } from '../agents/port.js';
import type { Task } from './domain.js';
import type { TaskProvider } from './port.js';
export function assignTask(
  provider: TaskProvider,
  agents: AgentRepository,
  id: string,
  owner: string,
  at: string,
): Task {
  if (!agents.list().some((agent) => agent.id === owner))
    throw new Error(`Agent ${JSON.stringify(owner)} not found`);
  return provider.update(id, { owner }, at);
}
