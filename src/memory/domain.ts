export type MemoryType = 'semantic' | 'episodic' | 'procedural' | 'relational';
export function memorySearchPhrase(query: string): string {
  const length = Array.from(query).length;
  if (!query.trim() || length < 3 || length > 1024 || query.includes('\0'))
    throw new Error('Memory search requires 3–1024 Unicode characters without NUL');
  return '"' + query.replaceAll('"', '""') + '"';
}
export type SourceRef =
  | { readonly roomId: string; readonly messageId: string }
  | { readonly uri: string };
export function artifactSource(uri: string): string {
  const digest = /^org:\/\/artifacts\/([a-f0-9]{64})$/.exec(uri)?.[1];
  if (digest === undefined) throw new Error('Invalid Memory Artifact source');
  return digest;
}
export function eventSource(uri: string): string {
  const match = /^org:\/\/events\/([^/]+)$/.exec(uri);
  if (!match?.[1]) throw new Error('Invalid Memory Event source');
  const id = decodeURIComponent(match[1]);
  if (!id.trim() || encodeURIComponent(id) !== match[1])
    throw new Error('Invalid Memory Event source');
  return id;
}
export function taskReviewSource(uri: string): {
  readonly taskId: string;
  readonly reviewId: string;
} {
  const match = /^org:\/\/tasks\/([^/]+)\/reviews\/([^/]+)$/.exec(uri);
  if (!match?.[1] || !match[2]) throw new Error('Invalid Memory TaskReview source');
  const taskId = decodeURIComponent(match[1]);
  const reviewId = decodeURIComponent(match[2]);
  if (
    !taskId.trim() ||
    !reviewId.trim() ||
    encodeURIComponent(taskId) !== match[1] ||
    encodeURIComponent(reviewId) !== match[2]
  )
    throw new Error('Invalid Memory TaskReview source');
  return { taskId, reviewId };
}
function memorySource(value: unknown): SourceRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Memory source');
  const keys = Object.keys(value);
  if ('uri' in value && typeof value.uri === 'string' && keys.length === 1) {
    if (value.uri.startsWith('org://events/')) eventSource(value.uri);
    else if (value.uri.startsWith('org://artifacts/')) artifactSource(value.uri);
    else taskReviewSource(value.uri);
    return { uri: value.uri };
  }
  if (
    'roomId' in value &&
    'messageId' in value &&
    keys.length === 2 &&
    typeof value.roomId === 'string' &&
    typeof value.messageId === 'string' &&
    value.roomId.trim() &&
    value.messageId.trim()
  )
    return { roomId: value.roomId, messageId: value.messageId };
  throw new Error('Invalid Memory source');
}
export interface MemoryInput {
  readonly type: MemoryType;
  readonly scope: string;
  readonly content: string;
  readonly confidence: number;
  readonly sourceRefs: readonly SourceRef[];
  readonly supersedes?: string;
  readonly validFrom?: number;
  readonly validUntil?: number;
  readonly tags?: readonly string[];
  readonly entities?: readonly string[];
  readonly importance?: number;
}
export interface Memory {
  readonly id: string;
  readonly type: MemoryType;
  readonly scope: string;
  readonly content: string;
  readonly confidence: number;
  readonly sourceRefs: readonly SourceRef[];
  readonly supersedes: string | null;
  readonly createdAt: string;
  readonly status: 'active' | 'superseded' | 'invalidated';
  readonly validFrom?: number;
  readonly validUntil?: number;
  readonly tags?: readonly string[];
  readonly entities?: readonly string[];
  readonly importance?: number;
}
export function createMemory(
  input: MemoryInput,
  identity: { readonly id: string; readonly at: string },
): Memory {
  if (!['semantic', 'episodic', 'procedural', 'relational'].includes(input.type))
    throw new Error('Invalid Memory type');
  if (!/^(global|company|(?:department|project|agent|room|task):[^\s]+)$/.test(input.scope))
    throw new Error('Invalid Memory scope');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    throw new Error('Invalid Memory confidence');
  if ([identity.id, identity.at, input.content].some((v) => !v.trim()))
    throw new Error('Memory fields must not be empty');
  if (input.sourceRefs.length === 0) throw new Error('Memory requires source evidence');
  const refs = input.sourceRefs.map(memorySource);
  const sources = new Set<string>();
  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (sources.has(key)) throw new Error('Duplicate Memory source');
    sources.add(key);
  }
  if (
    input.supersedes !== undefined &&
    (!input.supersedes.trim() || input.supersedes === identity.id)
  )
    throw new Error('Invalid superseded Memory');
  for (const value of [input.validFrom, input.validUntil]) {
    if (value !== undefined && !validTime(value)) throw new Error('Invalid Memory validity time');
  }
  if (
    input.validFrom !== undefined &&
    input.validUntil !== undefined &&
    input.validFrom >= input.validUntil
  )
    throw new Error('Invalid Memory validity interval');
  for (const values of [input.tags, input.entities]) {
    if (
      values !== undefined &&
      (values.length > 32 ||
        new Set(values).size !== values.length ||
        values.some((value) => !value.trim() || value.length > 128))
    )
      throw new Error('Invalid Memory tags/entities');
  }
  if (
    input.importance !== undefined &&
    (!Number.isFinite(input.importance) || input.importance < 0 || input.importance > 1)
  )
    throw new Error('Invalid Memory importance');
  return {
    ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
    ...(input.entities === undefined ? {} : { entities: [...input.entities] }),
    ...(input.importance === undefined ? {} : { importance: input.importance }),
    ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    id: identity.id,
    type: input.type,
    scope: input.scope,
    content: input.content,
    confidence: input.confidence,
    sourceRefs: refs,
    supersedes: input.supersedes ?? null,
    createdAt: identity.at,
    status: 'active',
  };
}
export function replaceMemory(previous: Memory, replacement: Memory): Memory {
  if (
    previous.status !== 'active' ||
    replacement.status !== 'active' ||
    replacement.supersedes !== previous.id ||
    replacement.id === previous.id ||
    previous.type !== replacement.type ||
    previous.scope !== replacement.scope
  )
    throw new Error('Memory replacement requires same type/scope active predecessor');
  return { ...previous, status: 'superseded' };
}
export function memoryLabels(items: unknown): readonly string[] {
  if (!Array.isArray(items)) throw new Error('Invalid Memory tags/entities');
  return items.map((item: unknown) => {
    if (typeof item !== 'string') throw new Error('Invalid Memory tags/entities');
    return item;
  });
}

export function decodeMemory(value: unknown): Memory {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('id' in value) ||
    !('type' in value) ||
    !('scope' in value) ||
    !('content' in value) ||
    !('confidence' in value) ||
    !('sourceRefs' in value) ||
    !('supersedes' in value) ||
    !('createdAt' in value) ||
    typeof value.id !== 'string' ||
    typeof value.scope !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.confidence !== 'number' ||
    ('validFrom' in value && typeof value.validFrom !== 'number') ||
    ('validUntil' in value && typeof value.validUntil !== 'number') ||
    ('importance' in value && typeof value.importance !== 'number') ||
    !Array.isArray(value.sourceRefs) ||
    (value.supersedes !== null && typeof value.supersedes !== 'string') ||
    (value.type !== 'semantic' &&
      value.type !== 'episodic' &&
      value.type !== 'procedural' &&
      value.type !== 'relational')
  )
    throw new Error('Invalid stored Memory');
  const refs = value.sourceRefs.map(memorySource);
  const tags = 'tags' in value ? memoryLabels(value.tags) : undefined;
  const entities = 'entities' in value ? memoryLabels(value.entities) : undefined;
  return createMemory(
    {
      ...(tags === undefined ? {} : { tags }),
      ...(entities === undefined ? {} : { entities }),
      ...('importance' in value && typeof value.importance === 'number'
        ? { importance: value.importance }
        : {}),
      type: value.type,
      scope: value.scope,
      content: value.content,
      confidence: value.confidence,
      sourceRefs: refs,
      ...(value.supersedes === null ? {} : { supersedes: value.supersedes }),
      ...('validFrom' in value && typeof value.validFrom === 'number'
        ? { validFrom: value.validFrom }
        : {}),
      ...('validUntil' in value && typeof value.validUntil === 'number'
        ? { validUntil: value.validUntil }
        : {}),
    },
    { id: value.id, at: value.createdAt },
  );
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000;
}
export function memoryIsValidAt(memory: Memory, at: number): boolean {
  if (memory.status !== 'active') return false;
  if (memory.validFrom === undefined && memory.validUntil === undefined) return true;
  if (!validTime(at)) throw new Error('Invalid Memory retrieval time');
  return (
    (memory.validFrom === undefined || at >= memory.validFrom) &&
    (memory.validUntil === undefined || at < memory.validUntil)
  );
}
