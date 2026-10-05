import { createTask, type Task } from '../tasks/domain.js';
import type { IdempotentTaskWriter } from '../tasks/port.js';
import { requireCapability } from '../agents/domain.js';
import { createA2AMessage, readA2AMessage, validateA2AReply } from './domain.js';
import type { A2AInput, A2AMessage } from './domain.js';
import type { Identity, Message } from '../rooms/domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { AgentRepository } from '../agents/port.js';
export function authorizeA2AMessage(agents: Pick<AgentRepository, 'list'>, message: Message): void {
  const envelope = readA2AMessage(message);
  if (envelope.type !== 'delegate') return;
  const sender = agents.list().find((agent) => agent.id === envelope.from);
  if (!sender) throw new Error('A2A Agent not found');
  requireCapability(sender, 'can_delegate');
}
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
  authorizeA2AMessage(agents, planned);
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

export function delegateA2ATask(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: { get(id: string): unknown } & IdempotentTaskWriter,
  roomId: string,
  messageId: string,
): Task {
  if (rooms.get(roomId).archivedAt !== null) throw new Error('Delegation Room is archived');
  const envelope = listA2AMessages(rooms, roomId, tasks).find(
    (message) => message.id === messageId,
  );
  if (!envelope || envelope.type !== 'delegate' || envelope.from === envelope.to)
    throw new Error('Expected delegate to another Agent');
  const known = agents.list();
  const sender = known.find((agent) => agent.id === envelope.from);
  if (!sender || !known.some((agent) => agent.id === envelope.to))
    throw new Error('A2A Agent not found');
  requireCapability(sender, 'can_delegate');
  const task = {
    ...createTask(
      {
        title: `Delegate: ${envelope.id}`,
        objective: `Delegated by Agent ${envelope.from}: ${JSON.stringify(envelope.payload)}`,
        kind: 'execution_task',
        ...(envelope.taskId === null ? {} : { parentId: envelope.taskId }),
        labels: ['a2a-delegate'],
      },
      { id: `a2a:${envelope.id}`, createdAt: envelope.createdAt },
    ),
    externalRef: `org://rooms/${envelope.roomId}/messages/${envelope.id}`,
  };
  return tasks.createAssignedOnce(task, envelope.to, envelope.createdAt);
}
