import type { Memory } from './domain.js';
export interface MemoryProvider {
  create(memory: Memory): Memory;
  get(id: string): Memory;
  list(scopes?: readonly string[]): readonly Memory[];
  search(query: string, scopes?: readonly string[]): readonly Memory[];
  invalidate(id: string, reason: string, at: string): Memory;
}
