import { memoryIsValidAt } from './domain.js';
import type { Memory, MemoryType } from './domain.js';
export function selectMemories(
  memories: readonly Memory[],
  input: {
    readonly scopes?: readonly string[];
    readonly at?: number;
    readonly type?: MemoryType;
    readonly tag?: string;
    readonly entity?: string;
    readonly query?: string;
    readonly fullTextIds?: readonly string[];
  },
): readonly Memory[] {
  const query = input.query?.toLowerCase() ?? '';
  const relevant = (memory: Memory): number =>
    query &&
    [...(memory.tags ?? []), ...(memory.entities ?? [])].some((label) =>
      query.includes(label.toLowerCase()),
    )
      ? 1
      : 0;
  return memories
    .filter(
      (memory) =>
        (input.scopes === undefined || input.scopes.includes(memory.scope)) &&
        (input.at === undefined || memoryIsValidAt(memory, input.at)) &&
        (input.type === undefined || memory.type === input.type) &&
        (input.tag === undefined || memory.tags?.includes(input.tag)) &&
        (input.entity === undefined || memory.entities?.includes(input.entity)),
    )
    .sort(
      (a, b) =>
        (input.scopes === undefined
          ? 0
          : input.scopes.indexOf(a.scope) - input.scopes.indexOf(b.scope)) ||
        relevant(b) - relevant(a) ||
        b.createdAt.localeCompare(a.createdAt) ||
        (b.importance ?? 0) - (a.importance ?? 0) ||
        Number(input.fullTextIds?.includes(b.id) ?? false) -
          Number(input.fullTextIds?.includes(a.id) ?? false) ||
        a.id.localeCompare(b.id),
    );
}
