import type { Event } from '../events/domain.js';
import type { AuditEntry, AuditActor } from './domain.js';
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid Workflow Audit text');
  return value;
}
function reference(value: unknown): string | null {
  return value === null ? null : text(value);
}
function actor(payload: Event['payload']): AuditActor {
  const kind = payload.actorKind;
  if (kind !== 'agent' && kind !== 'human' && kind !== 'system')
    throw new Error('Invalid Workflow Audit actor');
  return { kind, id: text(payload.actorId) };
}
export function buildWorkflowAudit(events: readonly Event[]): readonly AuditEntry[] {
  const originals = new Map(events.map((event) => [event.id, event]));
  const entries: AuditEntry[] = [];
  for (const event of events) {
    if (
      event.source !== 'workflow:n8n' ||
      ![
        'workflow.requested',
        'workflow.started',
        'workflow.unconfirmed',
        'workflow.status_observed',
        'workflow.cancel_observed',
      ].includes(event.type)
    )
      continue;
    const requested =
      event.type === 'workflow.requested' ? event : originals.get(text(event.payload.requestId));
    if (!requested || requested.type !== 'workflow.requested' || requested.source !== event.source)
      throw new Error('Workflow Audit receipt does not match claim');
    // Legacy originals do not identify an actor; do not invent historical caller identities.
    if (requested.payload.actorKind === undefined) continue;
    const payload = requested.payload;
    if (event.type === 'workflow.started' || event.type === 'workflow.unconfirmed') {
      for (const key of [
        'host',
        'workflowId',
        'inputDigest',
        'actorId',
        'actorKind',
        'taskId',
        'eventId',
        'proposalRef',
        'approvalId',
        'effect',
      ])
        if (event.payload[key] !== payload[key])
          throw new Error('Workflow Audit context does not match claim');
    }
    let result: AuditEntry['result'] = 'pending',
      executor = actor(payload),
      outputRef = `org://events/${encodeURIComponent(event.id)}`;
    if (event.type === 'workflow.started') {
      result = 'started';
      outputRef = `org://workflows/${encodeURIComponent(text(payload.workflowId))}/executions/${encodeURIComponent(text(event.payload.executionId))}`;
    } else if (event.type === 'workflow.unconfirmed') result = 'unconfirmed';
    else if (
      event.type === 'workflow.status_observed' ||
      event.type === 'workflow.cancel_observed'
    ) {
      const started = originals.get(requested.id + ':started');
      if (
        !started ||
        started.type !== 'workflow.started' ||
        started.source !== event.source ||
        started.payload.requestId !== requested.id ||
        event.payload.host !== payload.host ||
        event.payload.workflowId !== payload.workflowId ||
        event.payload.executionId !== started.payload.executionId
      )
        throw new Error('Workflow Audit observation does not match execution');
      executor = actor(event.payload);
      const status = event.payload.status;
      if (status === 'success') result = 'succeeded';
      else if (status === 'error' || status === 'crashed') result = 'failed';
      else if (status === 'canceled') result = 'canceled';
      else if (['new', 'running', 'waiting', 'unknown'].includes(text(status))) result = 'observed';
      else throw new Error('Invalid Workflow Audit status');
    }
    const digest = text(payload.inputDigest);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid Workflow Audit digest');
    entries.push({
      id: 'workflow:' + event.id,
      causalId: requested.id,
      actor: executor,
      taskId: reference(payload.taskId),
      eventId: reference(payload.eventId),
      tool:
        event.type === 'workflow.cancel_observed'
          ? 'workflow.cancel'
          : event.type === 'workflow.status_observed'
            ? 'workflow.status'
            : 'workflow.invoke',
      inputRef:
        event.type === 'workflow.requested'
          ? 'org://workflow-inputs/' + digest
          : `org://events/${encodeURIComponent(requested.id)}`,
      outputRef,
      at: event.createdAt,
      result,
      approvalId: reference(payload.approvalId),
    });
  }
  return entries;
}
