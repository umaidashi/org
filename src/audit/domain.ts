import type { Approval } from '../approvals/domain.js';
import type { CapabilityChange } from '../agents/permissions.js';
import type { Participant } from '../rooms/domain.js';
export type AuditActor = Participant | { readonly kind: 'system'; readonly id: string };
export interface AuditEntry {
  readonly causalId?: string;
  readonly id: string;
  readonly actor: AuditActor;
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
    | 'failed'
    | 'unconfirmed'
    | 'observed'
    | 'canceled';
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
        : (a.approvalId ?? a.causalId ?? a.taskId ?? a.id) <
            (b.approvalId ?? b.causalId ?? b.taskId ?? b.id)
          ? -1
          : (a.approvalId ?? a.causalId ?? a.taskId ?? a.id) >
              (b.approvalId ?? b.causalId ?? b.taskId ?? b.id)
            ? 1
            : a.approvalId === null &&
                b.approvalId === null &&
                a.causalId === undefined &&
                b.causalId === undefined
              ? 0
              : phase(a) - phase(b),
  );
}

function phase(entry: AuditEntry): number {
  if (entry.result === 'pending') return entry.tool === 'workflow.invoke' ? 2 : 0;
  if (entry.result === 'approved' || entry.result === 'rejected') return 1;
  if (entry.result === 'applied') return 2;
  return entry.result === 'started' ? 3 : 4;
}
