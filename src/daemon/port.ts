import type { Delivery, DeliveryPlan } from './domain.js';
export interface DeliveryJournal {
  begin(plan: DeliveryPlan): Delivery;
  complete(key: string, taskId: string): Delivery;
  defer(key: string, reason: string): Delivery;
  list(): readonly Delivery[];
}
