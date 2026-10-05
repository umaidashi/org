import type { MemoryProvider } from './port.js';
import type { Memory } from './domain.js';
import { selectMemories } from './retrieval.js';
export interface MemoryRetrievalInput {
  readonly scopes: readonly string[];
  readonly at: number;
  readonly query: string;
}
export interface MemoryRetriever {
  retrieve(input: MemoryRetrievalInput): readonly Memory[];
}
export function createScopedMemoryRetriever(
  provider: Pick<MemoryProvider, 'list'> & Partial<Pick<MemoryProvider, 'search'>>,
): MemoryRetriever {
  return {
    retrieve(input) {
      const records = selectMemories(provider.list(input.scopes), input);
      const length = Array.from(input.query).length;
      const hits =
        provider.search &&
        input.query.trim() &&
        length >= 3 &&
        length <= 1024 &&
        !input.query.includes('\0')
          ? selectMemories(provider.search(input.query, input.scopes), input)
          : [];
      return selectMemories(records, { ...input, fullTextIds: hits.map((m) => m.id) });
    },
  };
}
