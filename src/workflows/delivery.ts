import { createHash } from 'node:crypto';
import type { EventBus } from '../events/port.js';
import type { DeliveryJournal } from '../daemon/port.js';
import type { Delivery } from '../daemon/domain.js';
import { planDeliveries } from '../daemon/domain.js';
import type { WorkflowRuntime } from './port.js';
import { invokeWorkflow } from './service.js';

export async function pollWorkflowDeliveries(
  bus: Pick<EventBus, 'list' | 'subscriptions' | 'publish'>,
  journal: Pick<DeliveryJournal, 'begin' | 'completeWorkflow' | 'defer'>,
  configured: {
    readonly runtime: Pick<WorkflowRuntime, 'invoke'>;
    readonly host: string;
    readonly workflows: ReadonlySet<string>;
  },
  now: () => string,
  signal?: AbortSignal,
): Promise<readonly Delivery[]> {
  const originals = bus.list();
  const events = new Map(originals.map((event) => [event.id, event]));
  const plans = planDeliveries(
    originals.filter((event) => event.source !== 'workflow:n8n'),
    bus.subscriptions().filter((subscription) => subscription.subscriberType === 'workflow'),
  );
  const results: Delivery[] = [];
  for (const plan of plans) {
    if (signal?.aborted) break;
    const receipt = journal.begin(plan);
    if (receipt.status !== 'pending') {
      results.push(receipt);
      continue;
    }
    if (!configured.workflows.has(plan.subscription.subscriberId)) {
      results.push(journal.defer(plan.key, 'Workflow is not allowed by host'));
      continue;
    }
    const requestId = 'workflow:delivery:' + createHash('sha256').update(plan.key).digest('hex');
    const requested = events.get(requestId),
      started = events.get(requestId + ':started');
    if (requested) {
      if (
        requested.type === 'workflow.requested' &&
        requested.source === 'workflow:n8n' &&
        requested.payload.host === configured.host &&
        requested.payload.workflowId === plan.subscription.subscriberId &&
        started?.type === 'workflow.started' &&
        started.source === requested.source &&
        started.payload.requestId === requestId &&
        started.payload.host === configured.host &&
        started.payload.workflowId === requested.payload.workflowId &&
        typeof started.payload.executionId === 'string'
      )
        results.push(journal.completeWorkflow(plan.key, requestId));
      else
        results.push(
          journal.defer(plan.key, 'Workflow outcome is unconfirmed; automatic replay denied'),
        );
      continue;
    }
    const input = {
      eventId: plan.event.id,
      type: plan.event.type,
      source: plan.event.source,
      payload: plan.event.payload,
      createdAt: plan.event.createdAt,
    };
    try {
      await invokeWorkflow(
        bus,
        configured.runtime,
        {
          workflowId: plan.subscription.subscriberId,
          host: configured.host,
          input,
          inputDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        },
        { id: requestId, createdAt: now() },
        now,
      );
    } catch {
      results.push(
        journal.defer(plan.key, 'Workflow outcome is unconfirmed; automatic replay denied'),
      );
      continue;
    }
    // A journal failure propagates; the next poll recovers the immutable started receipt.
    results.push(journal.completeWorkflow(plan.key, requestId));
  }
  return results;
}
