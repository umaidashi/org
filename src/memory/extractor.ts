import { createMemory, memoryLabels, type MemoryInput } from './domain.js';
export interface MemoryCandidate extends Pick<
  MemoryInput,
  'type' | 'content' | 'confidence' | 'tags' | 'entities' | 'importance'
> {
  readonly sourceMessageIds: readonly string[];
  readonly sourceUris?: readonly string[];
  readonly supersedes?: string;
}
export interface MemoryExtractor {
  extract(content: string): readonly MemoryCandidate[];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Memory candidate object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unknown Memory candidate field');
}
export const jsonMemoryExtractor: MemoryExtractor = {
  extract(content) {
    if (new TextEncoder().encode(content).byteLength > 65536)
      throw new Error('Memory proposal exceeds 64KiB');
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new Error('Invalid Memory proposal JSON');
    }
    const proposal = record(decoded);
    keys(proposal, ['version', 'tool', 'candidates']);
    if (
      proposal.version !== 1 ||
      proposal.tool !== 'memory' ||
      !Array.isArray(proposal.candidates) ||
      proposal.candidates.length < 1 ||
      proposal.candidates.length > 10
    )
      throw new Error('Invalid Memory proposal');
    const candidates: readonly unknown[] = proposal.candidates;
    return candidates.map((item) => {
      const c = record(item);
      keys(c, [
        'type',
        'content',
        'confidence',
        'sourceMessageIds',
        'sourceUris',
        'supersedes',
        'tags',
        'entities',
        'importance',
      ]);
      if (
        (c.type !== 'semantic' &&
          c.type !== 'episodic' &&
          c.type !== 'procedural' &&
          c.type !== 'relational') ||
        typeof c.content !== 'string' ||
        new TextEncoder().encode(c.content).byteLength > 16384 ||
        typeof c.confidence !== 'number' ||
        (c.importance !== undefined && typeof c.importance !== 'number') ||
        !Array.isArray(c.sourceMessageIds) ||
        c.sourceMessageIds.length < 1 ||
        c.sourceMessageIds.length > 20 ||
        (c.supersedes !== undefined && typeof c.supersedes !== 'string')
      )
        throw new Error('Invalid typed Memory candidate');
      const sources: readonly unknown[] = c.sourceMessageIds;
      const sourceMessageIds = sources.map((id) => {
        if (typeof id !== 'string' || !id.trim())
          throw new Error('Invalid Memory candidate source');
        return id;
      });
      if (new Set(sourceMessageIds).size !== sourceMessageIds.length)
        throw new Error('Duplicate Memory candidate source');
      let sourceUris: string[] | undefined;
      if (c.sourceUris !== undefined) {
        if (!Array.isArray(c.sourceUris) || c.sourceUris.length > 20)
          throw new Error('Invalid Memory candidate source URIs');
        sourceUris = c.sourceUris.map((uri: unknown) => {
          if (typeof uri !== 'string' || uri.length > 2048)
            throw new Error('Invalid Memory candidate source URI');
          return uri;
        });
        if (new Set(sourceUris).size !== sourceUris.length)
          throw new Error('Duplicate Memory candidate source URI');
      }
      const candidate: MemoryCandidate = {
        ...(sourceUris === undefined ? {} : { sourceUris }),
        ...(c.tags === undefined ? {} : { tags: memoryLabels(c.tags) }),
        ...(c.entities === undefined ? {} : { entities: memoryLabels(c.entities) }),
        ...(c.importance === undefined ? {} : { importance: c.importance }),
        type: c.type,
        content: c.content,
        confidence: c.confidence,
        sourceMessageIds,
        ...(c.supersedes === undefined ? {} : { supersedes: c.supersedes }),
      };
      createMemory(
        {
          ...candidate,
          scope: 'room:validation',
          sourceRefs: [
            { roomId: 'validation', messageId: 'validation' },
            ...(sourceUris ?? []).map((uri) => ({ uri })),
          ],
        },
        { id: 'validation', at: 'validation' },
      );
      return candidate;
    });
  },
};
