import type { MemoryProvider } from '../memory/port.js';
import type { RoomRepository } from './port.js';
import type { Message } from './domain.js';
import type { SessionStore } from '../sessions/port.js';
import type { LocalAgentRuntime } from '../runtime/manager.js';
export async function replyToRoomMessage(
  rooms: Pick<RoomRepository, 'get' | 'messages' | 'append'>,
  sessions: Pick<SessionStore, 'get'>,
  runtime: Pick<LocalAgentRuntime, 'send'>,
  input: { readonly sessionId: string; readonly messageId: string; readonly instruction: string },
  identity: { readonly id: string; readonly at: string },
  memory?: Pick<MemoryProvider, 'list'>,
): Promise<Message> {
  const session = sessions.get(input.sessionId);
  const room = rooms.get(session.roomId);
  if (room.id !== session.roomId || room.archivedAt !== null)
    throw new Error('Session Room unavailable');
  if (!room.participants.some((p) => p.kind === 'agent' && p.id === session.agentId))
    throw new Error('Session Agent is not a Room participant');
  const messages = rooms.messages(room.id);
  const index = messages.findIndex((m) => m.id === input.messageId && m.roomId === room.id);
  if (index < 0) throw new Error('Source Message not found in Session Room');
  const source = messages[index];
  if (!source) throw new Error('Source Message unavailable');
  const existing = messages.find(
    (m) =>
      m.replyTo === source.id &&
      m.sender.kind === 'agent' &&
      m.sender.id === session.agentId &&
      m.metadata.sessionId === session.id,
  );
  if (existing) return existing;
  const scopes = [
    'room:' + room.id,
    'agent:' + session.agentId,
    ...(room.taskId === null ? [] : ['task:' + room.taskId]),
    'company',
    'global',
  ];
  const relevant = (memory?.list(scopes) ?? [])
    .filter((m) => m.status === 'active' && scopes.includes(m.scope))
    .sort(
      (a, b) =>
        scopes.indexOf(a.scope) - scopes.indexOf(b.scope) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
  let memories = relevant.slice(0, 20);
  let history = messages.slice(Math.max(0, index - 29), index + 1);
  const encode = () =>
    JSON.stringify({
      instruction: input.instruction,
      memories: memories.map(({ id, type, scope, content, confidence, sourceRefs }) => ({
        id,
        type,
        scope,
        content,
        confidence,
        sourceRefs,
      })),
      omittedMemories: relevant.length - memories.length,
      room: { id: room.id, title: room.title, type: room.type },
      omittedMessages: index + 1 - history.length,
      messages: history.map(({ id, sender, content, replyTo }) => ({
        id,
        sender,
        content,
        replyTo,
      })),
    });
  let context = encode();
  while (new TextEncoder().encode(context).byteLength > 65536 && memories.length > 0) {
    memories = memories.slice(0, -1);
    context = encode();
  }
  while (new TextEncoder().encode(context).byteLength > 65536 && history.length > 1) {
    history = history.slice(1);
    context = encode();
  }
  if (new TextEncoder().encode(context).byteLength > 65536)
    throw new Error('Source Message context exceeds 64KiB');
  const reply = await runtime.send(session.id, source.content, context);
  if (reply.session.id !== session.id || reply.session.status !== 'idle')
    throw new Error('Runtime reply does not match active Session');
  return rooms.append(
    room.id,
    {
      sender: { kind: 'agent', id: session.agentId },
      content: reply.text,
      replyTo: source.id,
      metadata: { sessionId: session.id },
    },
    { id: identity.id, createdAt: identity.at },
  );
}
