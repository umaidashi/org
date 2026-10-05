import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { EventBus } from '../events/port.js';
import type { CapabilityChange } from '../agents/permissions.js';
import { buildAudit, type AuditEntry } from './domain.js';
import { buildTaskExecutionAudit } from './tasks.js';
import { buildWorkflowAudit } from './workflows.js';
export function collectAudit(
  approvals: Pick<ApprovalStore, 'list'>,
  agents: { capabilityHistory(): readonly CapabilityChange[] },
  tasks: Pick<TaskProvider, 'list' | 'history'>,
  events: Pick<EventBus, 'list'>,
): readonly AuditEntry[] {
  return buildAudit(approvals.list(), agents.capabilityHistory(), [
    ...tasks.list().flatMap((task) => buildTaskExecutionAudit(tasks.history(task.id))),
    ...buildWorkflowAudit(events.list()),
  ]);
}
