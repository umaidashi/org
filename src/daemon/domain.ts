import { matchesSubscription } from '../events/domain.js';
import type { Event, Subscription } from '../events/domain.js';
import { createTask } from '../tasks/domain.js';
import type { Task } from '../tasks/domain.js';
export interface DeliveryPlan {
  readonly key: string;
  readonly event: Event;
  readonly subscription: Subscription;
  readonly task: Task | null;
}
export interface Delivery {
  readonly key: string;
  readonly eventId: string;
  readonly subscriptionId: string;
  readonly taskId: string | null;
  readonly status: 'pending' | 'delivered' | 'deferred';
  readonly attempts: number;
  readonly reason: string | null;
}
export function planDeliveries(
  events: readonly Event[],
  subscriptions: readonly Subscription[],
): readonly DeliveryPlan[] {
  return events.flatMap((event) =>
    subscriptions
      .filter((subscription) => matchesSubscription(subscription, event))
      .map((subscription) => {
        const key = `delivery:${event.id.length}:${event.id}:${subscription.id}`;
        const task =
          subscription.subscriberType === 'agent'
            ? {
                ...createTask(
                  {
                    title: `${event.type}: ${event.id}`,
                    objective: `Process ${event.type} from ${event.source}: ${JSON.stringify(event.payload)}`,
                    kind: 'execution_task',
                    labels: ['event-dispatch'],
                  },
                  { id: key, createdAt: event.createdAt },
                ),
                externalRef: `org:event:${event.id}`,
              }
            : null;
        return { key, event, subscription, task };
      }),
  );
}
