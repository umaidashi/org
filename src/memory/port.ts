import type { AuditActor, AuditEntry } from '../audit/domain.js';
import type { Memory } from './domain.js';
export interface MemoryProvider {
  create(memory: Memory, context?: MemoryOperationContext): Memory;
  createOnce(memory: Memory, context?: MemoryOperationContext): Memory;
  get(id: string): Memory;
  list(scopes?: readonly string[]): readonly Memory[];
  search(query: string, scopes?: readonly string[]): readonly Memory[];
  invalidate(id: string, reason: string, at: string): Memory;
}

export interface MemoryOperationReader {
  operationHistory(): readonly AuditEntry[];
}

export interface MemoryOperationContext {
  readonly actor: AuditActor;
  readonly taskId?: string;
}
