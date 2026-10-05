import { selectActivationAgents } from './domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { Message } from '../rooms/domain.js';
import type { SessionStore } from '../sessions/port.js';
import type { Session } from '../sessions/domain.js';
export async function activateRoomMessage(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  sessions: Pick<SessionStore, 'list'>,
  open: (agentId: string, roomId: string) => Session,
  reply: (sessionId: string, messageId: string) => Promise<Message>,
  roomId: string,
  messageId: string,
): Promise<readonly Message[]> {
  const room = rooms.get(roomId);
  const messages = rooms.messages(roomId);
  const source = messages.find((m) => m.id === messageId && m.roomId === roomId);
  if (!source) throw new Error('Activation Message not found in Room');
  const targets = selectActivationAgents(room, source);
  const results: Message[] = [];
  for (const agentId of targets) {
    const existing = messages.find(
      (m) =>
        m.roomId === roomId &&
        m.replyTo === messageId &&
        m.sender.kind === 'agent' &&
        m.sender.id === agentId &&
        typeof m.metadata.sessionId === 'string',
    );
    if (existing) {
      results.push(existing);
      continue;
    }
    const candidates = sessions.list().filter((s) => s.agentId === agentId && s.roomId === roomId);
    if (candidates.some((s) => s.status === 'running'))
      throw new Error('Agent Room Session is running');
    const session =
      candidates.find((s) => s.status === 'idle' || s.status === 'failed') ?? open(agentId, roomId);
    if (
      session.agentId !== agentId ||
      session.roomId !== roomId ||
      (session.status !== 'idle' && session.status !== 'failed')
    )
      throw new Error('Activation Session mismatch');
    const result = await reply(session.id, source.id);
    if (
      result.roomId !== roomId ||
      result.replyTo !== source.id ||
      result.sender.kind !== 'agent' ||
      result.sender.id !== agentId ||
      result.metadata.sessionId !== session.id
    )
      throw new Error('Activation reply mismatch');
    results.push(result);
  }
  return results;
}
