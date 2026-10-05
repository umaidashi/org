import { createEvent } from '../events/domain.js';
import type { EventInput, Identity } from '../events/domain.js';
export interface ScheduleInput {
  readonly name: string;
  readonly everyMs: number;
  readonly startAtMs: number;
  readonly event: EventInput;
}
export interface Schedule extends ScheduleInput, Identity {
  readonly enabled: boolean;
}
export function createSchedule(input: ScheduleInput, identity: Identity): Schedule {
  if (!input.name.trim()) throw new Error('Schedule name must not be empty');
  if (!Number.isSafeInteger(input.everyMs) || input.everyMs < 1)
    throw new Error('Invalid Schedule interval');
  if (!Number.isSafeInteger(input.startAtMs) || Math.abs(input.startAtMs) > 8640000000000000)
    throw new Error('Invalid Schedule start time');
  const event = createEvent(input.event, identity);
  return {
    ...input,
    ...identity,
    event: { type: event.type, source: event.source, payload: event.payload },
    enabled: true,
  };
}
export function dueSlot(
  schedule: Schedule,
  nowMs: number,
): { readonly index: number; readonly atMs: number } | null {
  if (!Number.isSafeInteger(nowMs) || Math.abs(nowMs) > 8640000000000000)
    throw new Error('Invalid Schedule current time');
  if (!schedule.enabled || nowMs < schedule.startAtMs) return null;
  const elapsed = nowMs - schedule.startAtMs;
  if (!Number.isSafeInteger(elapsed))
    throw new Error('Schedule time range exceeds safe arithmetic');
  // ponytail: coalesce missed slots; add bounded catch-up/cursor if every missed run is required.
  const index = Math.floor(elapsed / schedule.everyMs);
  return { index, atMs: schedule.startAtMs + index * schedule.everyMs };
}
