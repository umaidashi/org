import type { Schedule } from './domain.js';
export interface ScheduleRepository {
  create(schedule: Schedule): Schedule;
  get(id: string): Schedule;
  list(): readonly Schedule[];
  setEnabled(id: string, enabled: boolean): Schedule;
}
