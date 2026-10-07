import type { AuditActor, AuditEntry } from '../audit/domain.js';
import type { Session } from './domain.js';
export interface SessionStore {
  create(session: Session, context?: SessionOperationContext): void;
  get(id: string): Session;
  list(): readonly Session[];
  save(session: Session, expectedVersion: number, context?: SessionOperationContext): void;
  history(id: string): readonly Session[];
}

export interface SessionRebuilder {
  rebuildSession(
    originalId: string,
    expectedVersion: number,
    next: Session,
    context?: SessionOperationContext,
  ): Session;
}

export interface SessionOperationContext {
  readonly actor: AuditActor;
  readonly inputRef?: string;
  readonly taskId?: string;
}
export interface SessionOperationReader {
  operationHistory(): readonly AuditEntry[];
}
