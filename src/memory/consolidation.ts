import { memoryIsValidAt, validateMemoryScope, type Memory } from './domain.js';
import type { MemoryProvider } from './port.js';
import type { AgentRepository } from '../agents/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { RoomRepository } from '../rooms/port.js';
export interface MemoryConsolidationRequest {
  readonly scope: string;
  readonly key: string;
  readonly at: string;
}
export interface MemoryConsolidationReceipt extends MemoryConsolidationRequest {
  readonly keepers: readonly string[];
  readonly invalidated: readonly string[];
}
export interface MemoryConsolidationPlan extends MemoryConsolidationRequest {
  readonly duplicates: readonly { readonly keeper: Memory; readonly obsolete: Memory }[];
}
export interface MemoryConsolidationStore {
  getConsolidation(key: string): MemoryConsolidationReceipt | null;
  commitConsolidation(
    plan: MemoryConsolidationPlan,
    authorize: () => void,
  ): MemoryConsolidationReceipt;
}
export interface MemoryConsolidator {
  consolidate(input: MemoryConsolidationRequest): MemoryConsolidationReceipt;
}
export function validateConsolidationScope(scope: string): void {
  validateMemoryScope(scope);
}
export function validateConsolidationRequest(input: MemoryConsolidationRequest): void {
  validateConsolidationScope(input.scope);
  const time = new Date(input.at);
  if (
    !input.key.trim() ||
    input.key.length > 256 ||
    input.key.includes('\0') ||
    !Number.isFinite(time.getTime()) ||
    time.toISOString() !== input.at
  )
    throw new Error('Invalid Memory consolidation request');
}
export function planMemoryConsolidation(
  records: readonly Memory[],
  request: MemoryConsolidationRequest,
): MemoryConsolidationPlan {
  validateConsolidationRequest(request);
  if (new Set(records.map((m) => m.id)).size !== records.length)
    throw new Error('Duplicate Memory identities in consolidation input');
  const groups = new Map<string, Memory[]>();
  for (const memory of records) {
    if (memory.scope !== request.scope || !memoryIsValidAt(memory, Date.parse(request.at)))
      continue;
    const key = JSON.stringify([
      memory.type,
      memory.content,
      memory.confidence,
      memory.validFrom ?? null,
      memory.validUntil ?? null,
      memory.tags ?? null,
      memory.entities ?? null,
      memory.importance ?? null,
    ]);
    const group = groups.get(key) ?? [];
    group.push(memory);
    groups.set(key, group);
  }
  const duplicates: { keeper: Memory; obsolete: Memory }[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const keeper = ordered[0];
    if (!keeper) continue;
    for (const obsolete of ordered.slice(1)) duplicates.push({ keeper, obsolete });
  }
  duplicates.sort((a, b) => a.obsolete.id.localeCompare(b.obsolete.id));
  return { ...request, duplicates };
}
export function consolidationScopeAvailable(
  scope: string,
  readers: {
    readonly rooms: Pick<RoomRepository, 'get'>;
    readonly agents: Pick<AgentRepository, 'list'>;
    readonly tasks: Pick<TaskProvider, 'get'>;
  },
): boolean {
  validateConsolidationScope(scope);
  const separator = scope.indexOf(':'),
    kind = scope.slice(0, separator),
    id = scope.slice(separator + 1);
  if (kind === 'room') {
    const room = readers.rooms.get(id);
    if (room.id !== id) throw new Error('Memory consolidation Room mismatch');
    return room.archivedAt === null;
  }
  if (kind === 'agent' && !readers.agents.list().some((agent) => agent.id === id))
    throw new Error('Memory consolidation Agent not found');
  if (kind === 'task' && readers.tasks.get(id).id !== id)
    throw new Error('Memory consolidation Task mismatch');
  return true;
}
export function consolidateMemories(
  memories: Pick<MemoryProvider, 'list'>,
  store: MemoryConsolidationStore,
  request: MemoryConsolidationRequest,
  authorize: () => void,
): MemoryConsolidationReceipt {
  validateConsolidationRequest(request);
  authorize();
  const previous = store.getConsolidation(request.key);
  if (previous) {
    if (previous.scope !== request.scope)
      throw new Error('Memory consolidation key scope conflict');
    return previous;
  }
  return store.commitConsolidation(
    planMemoryConsolidation(memories.list([request.scope]), request),
    authorize,
  );
}
export function consolidateRoomMemories(
  rooms: Pick<RoomRepository, 'get'>,
  memories: Pick<MemoryProvider, 'list'>,
  store: MemoryConsolidationStore,
  request: MemoryConsolidationRequest,
): MemoryConsolidationReceipt {
  validateConsolidationRequest(request);
  if (!request.scope.startsWith('room:')) throw new Error('Room consolidation requires Room scope');
  const authorize = () => {
    const roomId = request.scope.slice('room:'.length),
      room = rooms.get(roomId);
    if (room.id !== roomId || room.archivedAt !== null)
      throw new Error('Memory consolidation requires active Room');
  };
  return consolidateMemories(memories, store, request, authorize);
}
