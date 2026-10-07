import type { AgentRepository } from '../agents/port.js';
import type { EventBus } from '../events/port.js';
import type { IdempotentTaskWriter } from '../tasks/port.js';
import { planDeliveries } from './domain.js';
import type { Delivery } from './domain.js';
import type { DeliveryJournal } from './port.js';
export async function pollDaemonStages(
  stages: readonly (() => void | Promise<void>)[],
  signal?: AbortSignal,
): Promise<void> {
  const errors: unknown[] = [];
  for (const stage of stages) {
    if (signal?.aborted) break;
    try {
      await stage();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Daemon polling failed');
}
export function releaseResources(resources: readonly { close(): void }[]): void {
  const errors: unknown[] = [];
  for (const resource of resources) {
    try {
      resource.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Daemon resource release failed');
}
export type PollStatus = {
  readonly state: 'running' | 'degraded';
  readonly processed: number;
  readonly error: string | null;
};
export function pollDispatch(dispatch: () => readonly Delivery[]): PollStatus {
  try {
    return { state: 'running', processed: dispatch().length, error: null };
  } catch (error) {
    return {
      state: 'degraded',
      processed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
export function dispatchEvents(
  bus: Pick<EventBus, 'list' | 'subscriptions'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: IdempotentTaskWriter,
  journal: Pick<DeliveryJournal, 'begin' | 'complete' | 'defer'>,
  workflowPolling = false,
): readonly Delivery[] {
  const plans = planDeliveries(
    bus.list(),
    bus
      .subscriptions()
      .filter((subscription) => !workflowPolling || subscription.subscriberType !== 'workflow'),
  );
  const agentIds = new Set(agents.list().map((agent) => agent.id));
  return plans.map((plan) => {
    const receipt = journal.begin(plan);
    if (receipt.status !== 'pending') return receipt;
    if (plan.task === null)
      return journal.defer(plan.key, 'Workflow invocation is not implemented');
    if (!agentIds.has(plan.subscription.subscriberId)) throw new Error('Delivery Agent not found');
    const task = tasks.createAssignedOnce(
      plan.task,
      plan.subscription.subscriberId,
      plan.event.createdAt,
      { eventId: plan.event.id },
    );
    return journal.complete(plan.key, task.id);
  });
}
