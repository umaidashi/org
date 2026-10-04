export type MemoryType = 'semantic' | 'episodic' | 'procedural' | 'relational';
export interface SourceRef {
  readonly roomId: string;
  readonly messageId: string;
}
export interface MemoryInput {
  readonly type: MemoryType;
  readonly scope: string;
  readonly content: string;
  readonly confidence: number;
  readonly sourceRefs: readonly SourceRef[];
  readonly supersedes?: string;
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
}
export function createMemory(
  input: MemoryInput,
  identity: { readonly id: string; readonly at: string },
): Memory {
  if (!['semantic', 'episodic', 'procedural', 'relational'].includes(input.type))
    throw new Error('Invalid Memory type');
  if (!/^(global|company|(?:department|project|agent|room|task):[^\s:]+)$/.test(input.scope))
    throw new Error('Invalid Memory scope');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    throw new Error('Invalid Memory confidence');
  if ([identity.id, identity.at, input.content].some((v) => !v.trim()))
    throw new Error('Memory fields must not be empty');
  if (input.sourceRefs.length === 0) throw new Error('Memory requires source evidence');
  const sources = new Set<string>();
  for (const ref of input.sourceRefs) {
    if (!ref.roomId.trim() || !ref.messageId.trim()) throw new Error('Invalid Memory source');
    const key = JSON.stringify([ref.roomId, ref.messageId]);
    if (sources.has(key)) throw new Error('Duplicate Memory source');
    sources.add(key);
  }
  if (
    input.supersedes !== undefined &&
    (!input.supersedes.trim() || input.supersedes === identity.id)
  )
    throw new Error('Invalid superseded Memory');
  return {
    id: identity.id,
    type: input.type,
    scope: input.scope,
    content: input.content,
    confidence: input.confidence,
    sourceRefs: input.sourceRefs.map((ref) => ({ ...ref })),
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
    !Array.isArray(value.sourceRefs) ||
    (value.supersedes !== null && typeof value.supersedes !== 'string') ||
    (value.type !== 'semantic' &&
      value.type !== 'episodic' &&
      value.type !== 'procedural' &&
      value.type !== 'relational')
  )
    throw new Error('Invalid stored Memory');
  const refs: SourceRef[] = value.sourceRefs.map((ref: unknown) => {
    if (
      ref === null ||
      typeof ref !== 'object' ||
      !('roomId' in ref) ||
      !('messageId' in ref) ||
      typeof ref.roomId !== 'string' ||
      typeof ref.messageId !== 'string'
    )
      throw new Error('Invalid stored Memory source');
    return { roomId: ref.roomId, messageId: ref.messageId };
  });
  return createMemory(
    {
      type: value.type,
      scope: value.scope,
      content: value.content,
      confidence: value.confidence,
      sourceRefs: refs,
      ...(value.supersedes === null ? {} : { supersedes: value.supersedes }),
    },
    { id: value.id, at: value.createdAt },
  );
}
