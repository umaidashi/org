import { dueSlot } from './domain.js';
import type { ScheduleRepository } from './port.js';
import { createEvent } from '../events/domain.js';
import type { EventBus } from '../events/port.js';
export function pollSchedules(
  schedules: Pick<ScheduleRepository, 'list'>,
  events: Pick<EventBus, 'publishOnce' | 'list'>,
  now: () => number,
): void {
  const at = now();
  const published = events.list();
  for (const schedule of schedules.list()) {
    const slot = dueSlot(schedule, at);
    if (slot !== null) {
      const prefix = `schedule:${schedule.id.length}:${schedule.id}:`;
      // ponytail: scan indexed receipts in memory; add an Event query if measured log volume requires it.
      let latest = -1;
      for (const event of published) {
        if (!event.id.startsWith(prefix)) continue;
        const suffix = event.id.slice(prefix.length);
        const index = Number(suffix);
        if (!/^(0|[1-9][0-9]*)$/.test(suffix) || !Number.isSafeInteger(index))
          throw new Error('Invalid scheduled Event slot');
        latest = Math.max(latest, index);
      }
      if (latest > slot.index) continue;
      events.publishOnce(
        createEvent(schedule.event, {
          id: `${prefix}${slot.index}`,
          createdAt: new Date(slot.atMs).toISOString(),
        }),
      );
    }
  }
}
