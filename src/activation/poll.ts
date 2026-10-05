import { selectActivationAgents } from './domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { SessionStore } from '../sessions/port.js';
import type { Message } from '../rooms/domain.js';
import type { WakeupJournal } from './port.js';
export async function pollRoomWakeups(
  rooms: Pick<RoomRepository, 'list' | 'messages'>,
  sessions: Pick<SessionStore, 'list'>,
  journal: Pick<WakeupJournal, 'get' | 'claim' | 'finish'>,
  activate: (roomId: string, messageId: string) => Promise<readonly Message[]>,
  now: () => string,
  signal?: AbortSignal,
): Promise<void> {
  // ponytail: scan local histories; add a cursor/index when measured history volume warrants it.
  if (signal?.aborted) return;
  for (const room of rooms.list()) {
    if (room.archivedAt !== null) continue;
    for (const message of rooms.messages(room.id)) {
      if (signal?.aborted) return;
      if (
        journal.get(message.id) ||
        (message.sender.kind === 'agent' &&
          !('a2a' in message.metadata) &&
          !('mentions' in message.metadata))
      )
        continue;
      let targets: readonly string[];
      try {
        targets = selectActivationAgents(room, message);
      } catch {
        if (journal.claim({ messageId: message.id, roomId: room.id, startedAt: now() }))
          journal.finish(message.id, {
            status: 'failed',
            replyIds: [],
            error: 'Invalid Room activation target',
            finishedAt: now(),
          });
        continue;
      }
      if (
        targets.length === 0 ||
        sessions
          .list()
          .some(
            (s) => s.roomId === room.id && s.status === 'running' && targets.includes(s.agentId),
          )
      )
        continue;
      if (!journal.claim({ messageId: message.id, roomId: room.id, startedAt: now() })) continue;
      let replies: readonly Message[];
      try {
        replies = await activate(room.id, message.id);
      } catch {
        journal.finish(message.id, {
          status: 'failed',
          replyIds: [],
          error: 'Automatic Room activation failed',
          finishedAt: now(),
        });
        continue;
      }
      journal.finish(message.id, {
        status: 'completed',
        replyIds: replies.map((m) => m.id),
        error: null,
        finishedAt: now(),
      });
    }
  }
}
export function recoverWakeups(
  journal: Pick<WakeupJournal, 'list' | 'finish'>,
  now: () => string,
): number {
  let recovered = 0;
  for (const record of journal.list())
    if (record.status === 'running') {
      journal.finish(record.messageId, {
        status: 'failed',
        replyIds: [],
        error: 'Room activation interrupted by daemon restart',
        finishedAt: now(),
      });
      recovered++;
    }
  return recovered;
}
