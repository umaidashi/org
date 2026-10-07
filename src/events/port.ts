import type { AuditEntry } from '../audit/domain.js';
import type { Event, Subscription } from './domain.js';
export interface EventBus {
  publish(event: Event): Event;
  publishOnce(event: Event): Event;
  get(id: string): Event;
  list(): readonly Event[];
  subscribe(subscription: Subscription): Subscription;
  subscriptions(): readonly Subscription[];
  setEnabled(id: string, enabled: boolean): Subscription;
}

export interface EventOperationReader {
  operationHistory(): readonly AuditEntry[];
}
