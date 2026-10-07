import type { Event } from '../events/domain.js';
import type { AuditEntry } from './domain.js';
export function buildSandboxAudit(events: readonly Event[]): readonly AuditEntry[] {
  const originals = new Map(events.map((event) => [event.id, event]));
  return events
    .filter(
      (event) =>
        event.source === 'sandbox:docker' &&
        ['sandbox.started', 'sandbox.completed'].includes(event.type),
    )
    .map((event) => {
      const payload = event.payload;
      const request =
        event.type === 'sandbox.started'
          ? event
          : typeof payload.requestId === 'string'
            ? originals.get(payload.requestId)
            : undefined;
      if (!request || request.source !== event.source || request.type !== 'sandbox.started')
        throw new Error('Sandbox Audit claim missing');
      for (const field of [
        'actorKind',
        'actorId',
        'taskId',
        'taskVersion',
        'eventId',
        'inputDigest',
        'proposalRef',
        'approvalId',
      ])
        if (payload[field] !== request.payload[field])
          throw new Error('Sandbox Audit context mismatch');
      if (
        payload.actorKind !== 'agent' ||
        typeof payload.actorId !== 'string' ||
        !payload.actorId.trim() ||
        typeof payload.taskId !== 'string' ||
        !payload.taskId.trim() ||
        typeof payload.taskVersion !== 'number' ||
        !Number.isSafeInteger(payload.taskVersion) ||
        payload.taskVersion < 1 ||
        typeof payload.inputDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(payload.inputDigest) ||
        payload.approvalId !== null ||
        (payload.eventId !== null &&
          (typeof payload.eventId !== 'string' || !payload.eventId.trim())) ||
        (payload.proposalRef !== null &&
          (typeof payload.proposalRef !== 'string' ||
            !payload.proposalRef.startsWith('org://rooms/')))
      )
        throw new Error('Invalid Sandbox Audit context');
      if (
        request.id !==
          'sandbox:' + encodeURIComponent(payload.taskId) + ':' + payload.taskVersion ||
        (event.type === 'sandbox.completed' && event.id !== request.id + ':completed')
      )
        throw new Error('Sandbox Audit identity mismatch');
      const result = event.type === 'sandbox.started' ? 'started' : payload.result;
      if (
        (event.type !== 'sandbox.started' || result !== 'started') &&
        result !== 'succeeded' &&
        result !== 'failed' &&
        result !== 'canceled'
      )
        throw new Error('Invalid Sandbox Audit result');
      if (
        event.type === 'sandbox.completed' &&
        (result === 'succeeded'
          ? typeof payload.outputRef !== 'string' ||
            !/^org:\/\/artifacts\/[a-f0-9]{64}$/.test(payload.outputRef)
          : payload.outputRef !== null)
      )
        throw new Error('Invalid Sandbox Audit output');
      return {
        id: 'sandbox:' + event.id,
        causalId: request.id,
        actor: { kind: 'agent', id: payload.actorId },
        taskId: payload.taskId,
        eventId: payload.eventId,
        tool: 'sandbox.run',
        inputRef: payload.proposalRef ?? 'org://sandbox-inputs/' + payload.inputDigest,
        outputRef:
          result === 'succeeded' && typeof payload.outputRef === 'string'
            ? payload.outputRef
            : 'org://events/' + encodeURIComponent(event.id),
        at: event.createdAt,
        result,
        approvalId: null,
      };
    });
}
