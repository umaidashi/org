import type { AgentRepository } from '../agents/port.js';
import type { Task } from './domain.js';
import type { TaskProvider } from './port.js';
export function recoverInterruptedExecutionTasks(
  provider: Pick<TaskProvider, 'list' | 'update'>,
  now: () => string,
): void {
  for (const task of provider.list({ kind: 'execution_task', status: 'running' })) {
    if (task.kind === 'execution_task' && task.status === 'running')
      provider.update(task.id, { status: 'failed' }, now(), task.version);
  }
}
export function assignTask(
  provider: Pick<TaskProvider, 'update'>,
  agents: Pick<AgentRepository, 'list'>,
  id: string,
  owner: string,
  at: string,
): Task {
  if (!agents.list().some((agent) => agent.id === owner))
    throw new Error(`Agent ${JSON.stringify(owner)} not found`);
  return provider.update(id, { owner }, at);
}
