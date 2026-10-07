import type { AuditEntry } from './domain.js';
export interface LogFilter {
  readonly agentId?: string;
  readonly taskId?: string;
  readonly eventId?: string;
  readonly limit: number;
}
export function selectAuditLogs(
  records: readonly AuditEntry[],
  filter: LogFilter,
): readonly AuditEntry[] {
  if (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 1000)
    throw new Error('Log limit must be an integer from 1 to 1000');
  if (
    filter.agentId !== undefined &&
    (typeof filter.agentId !== 'string' || !filter.agentId.trim() || filter.agentId.includes('\0'))
  )
    throw new Error('Invalid Agent log filter');
  return records
    .filter(
      (entry) =>
        (filter.agentId === undefined ||
          (entry.actor.kind === 'agent' && entry.actor.id === filter.agentId)) &&
        (filter.taskId === undefined || entry.taskId === filter.taskId) &&
        (filter.eventId === undefined || entry.eventId === filter.eventId),
    )
    .slice(-filter.limit);
}
