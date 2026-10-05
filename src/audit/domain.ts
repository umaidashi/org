import type { Approval } from '../approvals/domain.js';
import type { CapabilityChange } from '../agents/permissions.js';
import type { Participant } from '../rooms/domain.js';
export interface AuditEntry {
  readonly id: string;
  readonly actor: Participant;
  readonly taskId: string | null;
  readonly eventId: string | null;
  readonly tool: string;
  readonly inputRef: string;
  readonly outputRef: string;
  readonly at: string;
  readonly result:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'applied'
    | 'started'
    | 'succeeded'
    | 'failed';
  readonly approvalId: string | null;
}
export function buildAudit(
  approvals: readonly Approval[],
  changes: readonly CapabilityChange[],
  executions: readonly AuditEntry[] = [],
): readonly AuditEntry[] {
  const records: AuditEntry[] = [...executions];
  for (const { request, decision } of approvals) {
    const ref = `org://approvals/${encodeURIComponent(request.id)}`;
    const base = { taskId: request.taskId, eventId: request.eventId, approvalId: request.id };
    records.push({
      ...base,
      id: request.id + ':request',
      actor: request.actor,
      tool:
        request.operation.kind === 'agent_capabilities'
          ? 'agent.capabilities.request'
          : 'workflow.invoke.request',
      inputRef:
        request.operation.kind === 'agent_capabilities'
          ? `org://agents/${encodeURIComponent(request.operation.agentId)}/capabilities/${request.operation.expectedRevision}`
          : `org://workflow-inputs/${request.operation.inputDigest}`,
      outputRef: ref,
      at: request.createdAt,
      result: 'pending',
    });
    if (decision)
      records.push({
        ...base,
        id: request.id + ':decision',
        actor: decision.actor,
        tool: 'approval.decide',
        inputRef: ref,
        outputRef: ref + '/decision',
        at: decision.createdAt,
        result: decision.decision === 'approve' ? 'approved' : 'rejected',
      });
  }
  for (const change of changes)
    records.push({
      id: change.approvalId + ':apply',
      actor: change.actor,
      taskId: change.taskId,
      eventId: change.eventId,
      tool: change.tool,
      inputRef: change.inputRef,
      outputRef: change.outputRef,
      at: change.at,
      result: change.result,
      approvalId: change.approvalId,
    });
  return records.sort((a, b) =>
    a.at < b.at
      ? -1
      : a.at > b.at
        ? 1
        : (a.approvalId ?? a.taskId ?? a.id) < (b.approvalId ?? b.taskId ?? b.id)
          ? -1
          : (a.approvalId ?? a.taskId ?? a.id) > (b.approvalId ?? b.taskId ?? b.id)
            ? 1
            : a.approvalId === null && b.approvalId === null
              ? 0
              : phase(a.result) - phase(b.result),
  );
}

function phase(result: AuditEntry['result']): number {
  return result === 'pending' ? 0 : result === 'applied' ? 2 : 1;
}
