import type { RoomOperationReader } from '../rooms/port.js';
import type { SessionOperationReader } from '../sessions/port.js';
import type { MemoryOperationReader } from '../memory/port.js';
import type { AgentConfigurationReader } from '../agents/port.js';
import { buildSandboxAudit } from './sandbox.js';
import { buildLinearAudit } from './linear.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { TaskProvider, TaskOperationReader } from '../tasks/port.js';
import type { EventBus } from '../events/port.js';
import type { CapabilityChange } from '../agents/permissions.js';
import { buildAudit, type AuditEntry } from './domain.js';
import { buildTaskExecutionAudit } from './tasks.js';
import { buildWorkflowAudit } from './workflows.js';
export function collectAudit(
  approvals: Pick<ApprovalStore, 'list'>,
  agents: AgentConfigurationReader & { capabilityHistory(): readonly CapabilityChange[] },
  tasks: Pick<TaskProvider, 'list' | 'history'> & TaskOperationReader,
  events: Pick<EventBus, 'list'>,
  memories: MemoryOperationReader,
  sessions: SessionOperationReader,
  rooms: RoomOperationReader,
): readonly AuditEntry[] {
  const decisions = approvals.list();
  const originals = events.list();
  return buildAudit(decisions, agents.capabilityHistory(), [
    ...agents.configurationHistory(),
    ...memories.operationHistory(),
    ...sessions.operationHistory(),
    ...rooms.operationHistory(),
    ...tasks.operationHistory(),
    ...tasks.list().flatMap((task) => buildTaskExecutionAudit(tasks.history(task.id))),
    ...buildWorkflowAudit(originals),
    ...buildSandboxAudit(originals),
    ...buildLinearAudit(originals, decisions),
  ]);
}
