import type { AgentRepository } from '../agents/port.js';
import { createEvent, createSubscription, matchesSubscription } from './domain.js';
import type { Event, EventInput, Identity, Subscription, SubscriptionInput } from './domain.js';
import type { EventBus } from './port.js';
export function publishEvent(
  bus: Pick<EventBus, 'publish'>,
  input: EventInput,
  identity: Identity,
): Event {
  return bus.publish(createEvent(input, identity));
}
export function registerSubscription(
  bus: Pick<EventBus, 'subscribe'>,
  agents: Pick<AgentRepository, 'list'>,
  input: SubscriptionInput,
  identity: Identity,
): Subscription {
  const subscription = createSubscription(input, identity);
  if (
    input.subscriberType === 'agent' &&
    !agents.list().some((agent) => agent.id === input.subscriberId)
  )
    throw new Error('Subscriber Agent not found');
  return bus.subscribe(subscription);
}
export function matchingSubscriptions(
  bus: Pick<EventBus, 'get' | 'subscriptions'>,
  eventId: string,
): readonly Subscription[] {
  const event = bus.get(eventId);
  return bus.subscriptions().filter((subscription) => matchesSubscription(subscription, event));
}
