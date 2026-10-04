export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export interface Identity {
  readonly id: string;
  readonly createdAt: string;
}
export interface EventInput {
  readonly type: string;
  readonly source: string;
  readonly payload?: JsonObject;
}
export interface Event {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly payload: JsonObject;
  readonly createdAt: string;
}
export interface SubscriptionInput {
  readonly subscriberType: 'agent' | 'workflow';
  readonly subscriberId: string;
  readonly eventPattern: string;
  readonly filter?: JsonObject;
}
export interface Subscription {
  readonly id: string;
  readonly subscriberType: 'agent' | 'workflow';
  readonly subscriberId: string;
  readonly eventPattern: string;
  readonly filter: JsonObject;
  readonly enabled: boolean;
  readonly createdAt: string;
}
function nonempty(value: string): void {
  if (!value.trim()) throw new Error('Event fields must not be empty');
}
function segments(value: string, pattern: boolean): readonly string[] {
  const parts = value.split('.');
  if (
    !parts.every(
      (part, index) =>
        /^[a-zA-Z0-9_-]+$/.test(part) ||
        (pattern && (part === '*' || (part === '**' && index === parts.length - 1))),
    )
  )
    throw new Error('Invalid event name or pattern');
  return parts;
}
export function jsonObject(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected JSON object');
  return Object.fromEntries(
    Object.entries(value).map(([key, item]: [string, unknown]) => [key, jsonValue(item)]),
  );
}
function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => jsonValue(item));
  return jsonObject(value);
}
export function validateEventInput(input: EventInput): void {
  segments(input.type, false);
  nonempty(input.source);
  jsonObject(input.payload ?? {});
}
export function validateSubscriptionInput(input: SubscriptionInput): void {
  segments(input.eventPattern, true);
  nonempty(input.subscriberId);
  jsonObject(input.filter ?? {});
}
export function createEvent(input: EventInput, identity: Identity): Event {
  validateEventInput(input);
  nonempty(identity.id);
  nonempty(identity.createdAt);
  return {
    ...identity,
    type: input.type,
    source: input.source,
    payload: jsonObject(input.payload ?? {}),
  };
}
export function createSubscription(input: SubscriptionInput, identity: Identity): Subscription {
  validateSubscriptionInput(input);
  nonempty(identity.id);
  nonempty(identity.createdAt);
  return {
    ...identity,
    subscriberType: input.subscriberType,
    subscriberId: input.subscriberId,
    eventPattern: input.eventPattern,
    filter: jsonObject(input.filter ?? {}),
    enabled: true,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || typeof a !== 'object' || typeof b !== 'object')
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value: unknown, index: number) => equalJson(value, b[index]))
    );
  }
  if (!record(a) || !record(b)) return false;
  const entries = Object.entries(b);
  return (
    Object.keys(a).length === entries.length &&
    entries.every(([key, value]) => Object.hasOwn(a, key) && equalJson(a[key], value))
  );
}
export function matchesSubscription(subscription: Subscription, event: Event): boolean {
  if (!subscription.enabled) return false;
  const pattern = segments(subscription.eventPattern, true);
  const name = segments(event.type, false);
  for (const [index, part] of pattern.entries()) {
    if (part === '**') break;
    if (name[index] === undefined || (part !== '*' && part !== name[index])) return false;
  }
  if (pattern.at(-1) !== '**' && pattern.length !== name.length) return false;
  return Object.entries(subscription.filter).every(
    ([key, value]) => Object.hasOwn(event.payload, key) && equalJson(event.payload[key], value),
  );
}
