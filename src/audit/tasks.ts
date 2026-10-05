import type { TaskHistory } from '../tasks/port.js';
import type { AuditEntry } from './domain.js';
export function buildTaskExecutionAudit(history: readonly TaskHistory[]): readonly AuditEntry[] {
  const entries: AuditEntry[] = [];
  let previous: TaskHistory | undefined;
  let executor: string | null = null;
  for (const entry of history) {
    const task = entry.task;
    const result =
      task.status === 'running' && previous?.status !== 'running'
        ? 'started'
        : previous?.status === 'running' && task.status === 'waiting_approval'
          ? 'succeeded'
          : previous?.status === 'running' && task.status === 'failed'
            ? 'failed'
            : undefined;
    if (result === 'started') executor = task.owner;
    const owner = executor;
    if (task.kind === 'execution_task' && result !== undefined && owner) {
      const ref = `org://tasks/${encodeURIComponent(task.id)}/versions/`;
      entries.push({
        id: `task:${task.id}:${entry.version}`,
        actor: { kind: 'agent', id: owner },
        taskId: task.id,
        eventId: task.externalRef?.startsWith('org:event:')
          ? task.externalRef.slice('org:event:'.length)
          : null,
        tool: 'task.execution',
        inputRef: ref + (previous?.version ?? entry.version),
        outputRef: ref + entry.version,
        at: entry.at,
        result,
        approvalId: null,
      });
    }
    previous = entry;
  }
  return entries;
}
