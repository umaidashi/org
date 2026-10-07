import { validateRoomAllowlist } from '../rooms/domain.js';
import { createHash } from 'node:crypto';
import type { RoomRepository } from '../rooms/port.js';
import {
  validateConsolidationScope,
  type MemoryConsolidationReceipt,
  type MemoryConsolidator,
} from './consolidation.js';
export interface MemoryConsolidationHistory {
  latestConsolidation(prefix: string): MemoryConsolidationReceipt | null;
  listConsolidations(scope: string): readonly MemoryConsolidationReceipt[];
}
export function validateNightlyRooms(ids: readonly string[]): void {
  validateRoomAllowlist(ids);
}
export function pollMemoryConsolidations(
  rooms: Pick<RoomRepository, 'get'>,
  history: Pick<MemoryConsolidationHistory, 'latestConsolidation'>,
  consolidator: MemoryConsolidator,
  roomIds: readonly string[],
  now: () => number,
): void {
  validateNightlyRooms(roomIds);
  pollScopedMemoryConsolidations(
    history,
    consolidator,
    roomIds.map((id) => 'room:' + id),
    (scope) => {
      const roomId = scope.slice('room:'.length),
        room = rooms.get(roomId);
      if (room.id !== roomId) throw new Error('Nightly Memory Room mismatch');
      return room.archivedAt === null;
    },
    now,
  );
}
export function validateNightlyScopes(scopes: readonly string[]): void {
  if (scopes.length > 32 || new Set(scopes).size !== scopes.length)
    throw new Error('Invalid nightly Memory scope allowlist');
  scopes.forEach(validateConsolidationScope);
}
export function pollScopedMemoryConsolidations(
  history: Pick<MemoryConsolidationHistory, 'latestConsolidation'>,
  consolidator: MemoryConsolidator,
  scopes: readonly string[],
  available: (scope: string) => boolean,
  now: () => number,
): void {
  validateNightlyScopes(scopes);
  if (scopes.length === 0) return;
  const time = new Date(now());
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid Memory consolidation clock');
  const at = time.toISOString(),
    day = at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Unsupported Memory consolidation day');
  for (const scope of scopes) {
    if (!available(scope)) continue;
    const isRoom = scope.startsWith('room:'),
      prefix =
        (isRoom ? 'nightly-memory:' : 'nightly-scoped-memory:') +
        createHash('sha256')
          .update(isRoom ? scope.slice('room:'.length) : scope)
          .digest('hex') +
        ':';
    const previous = history.latestConsolidation(prefix);
    if (previous) {
      const priorDay = previous.key.slice(prefix.length);
      const priorTime = new Date(priorDay + 'T00:00:00.000Z');
      if (
        previous.scope !== scope ||
        !previous.key.startsWith(prefix) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(priorDay) ||
        !Number.isFinite(priorTime.getTime()) ||
        priorTime.toISOString().slice(0, 10) !== priorDay
      )
        throw new Error('Invalid nightly Memory receipt');
      if (priorDay >= day) continue;
    }
    consolidator.consolidate({ scope, key: prefix + day, at });
  }
}
