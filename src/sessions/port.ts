import type { Session } from './domain.js';
export interface SessionStore {
  create(session: Session): void;
  get(id: string): Session;
  list(): readonly Session[];
  save(session: Session, expectedVersion: number): void;
  history(id: string): readonly Session[];
}
