export interface MemoryContextGrant {
  readonly roomId: string;
  readonly agentId: string;
  readonly scopes: readonly string[];
}
export function memoryContextScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length)
    throw new Error('Invalid Memory context scopes');
  return value.map((scope: unknown) => {
    if (
      typeof scope !== 'string' ||
      !/^(department|project):[^\s\0]+$/.test(scope) ||
      scope.length > 256
    )
      throw new Error('Invalid Memory context scope');
    return scope;
  });
}
export function parseMemoryContextGrants(value: unknown): readonly MemoryContextGrant[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Invalid Memory context grants');
  const pairs = new Set<string>();
  return value.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !['roomId', 'agentId', 'scopes'].includes(key)) ||
      !('roomId' in entry) ||
      !('agentId' in entry) ||
      !('scopes' in entry) ||
      typeof entry.roomId !== 'string' ||
      typeof entry.agentId !== 'string' ||
      [entry.roomId, entry.agentId].some((id) => !id.trim() || id.includes('\0') || id.length > 128)
    )
      throw new Error('Invalid Memory context grant');
    const key = JSON.stringify([entry.roomId, entry.agentId]);
    if (pairs.has(key)) throw new Error('Duplicate Memory context grant');
    pairs.add(key);
    return {
      roomId: entry.roomId,
      agentId: entry.agentId,
      scopes: memoryContextScopes(entry.scopes),
    };
  });
}
