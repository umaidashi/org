import { createA2AMessage, readA2AMessage, validateA2AReply } from './domain.js';
import type { A2AInput, A2AMessage } from './domain.js';
import type { Identity } from '../rooms/domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { AgentRepository } from '../agents/port.js';
export function sendA2AMessage(
  rooms: Pick<RoomRepository, 'get' | 'messages' | 'append'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: { get(id: string): unknown },
  roomId: string,
  input: A2AInput,
  identity: Identity,
): A2AMessage {
  const room = rooms.get(roomId);
  const known = new Set(agents.list().map((agent) => agent.id));
  if (!known.has(input.from) || !known.has(input.to)) throw new Error('A2A Agent not found');
  const reply =
    input.replyTo === undefined
      ? undefined
      : rooms.messages(roomId).find((message) => message.id === input.replyTo);
  const planned = createA2AMessage(room, input, identity, reply);
  const envelope = readA2AMessage(planned);
  if (envelope.taskId !== null) tasks.get(envelope.taskId);
  const result = rooms.append(
    roomId,
    {
      sender: planned.sender,
      content: planned.content,
      metadata: planned.metadata,
      ...(planned.replyTo !== null ? { replyTo: planned.replyTo } : {}),
    },
    identity,
  );
  return readA2AMessage(result);
}
export function listA2AMessages(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  roomId: string,
  tasks: { get(id: string): unknown },
): readonly A2AMessage[] {
  const room = rooms.get(roomId);
  const messages = rooms.messages(roomId);
  return messages
    .filter((message) => 'a2a' in message.metadata)
    .map((message) => {
      const envelope = readA2AMessage(message);
      if (
        message.roomId !== room.id ||
        ![envelope.from, envelope.to].every((id) =>
          room.participants.some((p) => p.kind === 'agent' && p.id === id),
        )
      )
        throw new Error('Invalid A2A Room endpoints');
      if (room.taskId !== null && envelope.taskId !== room.taskId)
        throw new Error('Invalid A2A Task Room reference');
      if (envelope.taskId !== null) tasks.get(envelope.taskId);
      if (envelope.replyTo !== null) {
        const parent = messages.find((candidate) => candidate.id === envelope.replyTo);
        if (!parent) throw new Error('Invalid A2A reply reference');
        validateA2AReply(envelope, readA2AMessage(parent));
      }
      return envelope;
    });
}
