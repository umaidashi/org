import { createHash } from 'node:crypto';
import type { RoomRepository } from '../rooms/port.js';
import type { MemoryConsolidationReceipt, MemoryConsolidator } from './consolidation.js';
export interface MemoryConsolidationHistory {
  latestConsolidation(prefix: string): MemoryConsolidationReceipt | null;
  listConsolidations(scope: string): readonly MemoryConsolidationReceipt[];
}
export function validateNightlyRooms(ids: readonly string[]): void {
  if (
    ids.length > 32 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !id.trim() || /\s/.test(id) || id.length > 128 || id.includes('\0'))
  )
    throw new Error('Invalid nightly Memory Room allowlist');
}
export function pollMemoryConsolidations(
  rooms: Pick<RoomRepository, 'get'>,
  history: Pick<MemoryConsolidationHistory, 'latestConsolidation'>,
  consolidator: MemoryConsolidator,
  roomIds: readonly string[],
  now: () => number,
): void {
  validateNightlyRooms(roomIds);
  if (roomIds.length === 0) return;
  const time = new Date(now());
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid Memory consolidation clock');
  const at = time.toISOString(),
    day = at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Unsupported Memory consolidation day');
  for (const roomId of roomIds) {
    const room = rooms.get(roomId);
    if (room.id !== roomId) throw new Error('Nightly Memory Room mismatch');
    if (room.archivedAt !== null) continue;
    const scope = 'room:' + roomId,
      prefix = 'nightly-memory:' + createHash('sha256').update(roomId).digest('hex') + ':';
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
