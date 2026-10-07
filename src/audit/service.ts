import { buildSandboxAudit } from './sandbox.js';
import { buildLinearAudit } from './linear.js';
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
  const decisions = approvals.list();
  const originals = events.list();
  return buildAudit(decisions, agents.capabilityHistory(), [
    ...tasks.list().flatMap((task) => buildTaskExecutionAudit(tasks.history(task.id))),
    ...buildWorkflowAudit(originals),
    ...buildSandboxAudit(originals),
    ...buildLinearAudit(originals, decisions),
  ]);
}
