import { memoryContextScopes } from '../context/scopes.js';
import { createScopedMemoryRetriever, type MemoryRetriever } from '../memory/retriever.js';
import { boundedContextBuilder } from '../context/builder.js';
import type { ContextBuilder } from '../context/port.js';
import type { MemoryProvider } from '../memory/port.js';
import type { RoomRepository } from './port.js';
import type { Message } from './domain.js';
import type { SessionStore } from '../sessions/port.js';
import type { LocalAgentRuntime } from '../runtime/manager.js';
export async function replyToRoomMessage(
  rooms: Pick<RoomRepository, 'get' | 'messages' | 'append'>,
  sessions: Pick<SessionStore, 'get'>,
  runtime: Pick<LocalAgentRuntime, 'send'>,
  input: {
    readonly sessionId: string;
    readonly messageId: string;
    readonly instruction: string;
    readonly memoryScopes?: readonly string[];
    readonly taskExecution?: { readonly taskId: string; readonly version: number };
  },
  identity: { readonly id: string; readonly at: string },
  memory?: Pick<MemoryProvider, 'list'> & Partial<Pick<MemoryProvider, 'search'>>,
  builder: ContextBuilder = boundedContextBuilder,
  retriever?: MemoryRetriever,
): Promise<Message> {
  const session = sessions.get(input.sessionId);
  const room = rooms.get(session.roomId);
  if (room.id !== session.roomId || room.archivedAt !== null)
    throw new Error('Session Room unavailable');
  if (!room.participants.some((p) => p.kind === 'agent' && p.id === session.agentId))
    throw new Error('Session Agent is not a Room participant');
  if (
    input.taskExecution &&
    (room.type !== 'task' ||
      room.taskId !== input.taskExecution.taskId ||
      !Number.isSafeInteger(input.taskExecution.version) ||
      input.taskExecution.version < 1)
  )
    throw new Error('Task execution reference does not match Room');
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
  if (existing) {
    const reference = existing.metadata.taskExecution;
    if (
      input.taskExecution &&
      (reference === null ||
        typeof reference !== 'object' ||
        Array.isArray(reference) ||
        !('taskId' in reference) ||
        !('version' in reference) ||
        reference.taskId !== input.taskExecution.taskId ||
        reference.version !== input.taskExecution.version)
    )
      throw new Error('Existing reply belongs to another Task execution');
    return existing;
  }
  const scopes = [
    'room:' + room.id,
    'agent:' + session.agentId,
    ...(room.taskId === null ? [] : ['task:' + room.taskId]),
    ...memoryContextScopes(input.memoryScopes ?? []),
    'company',
    'global',
  ];
  const at = Date.parse(identity.at);
  const relevant = (
    retriever ?? createScopedMemoryRetriever(memory ?? { list: () => [] })
  ).retrieve({
    scopes,
    at,
    query: source.content,
  });
  const context = builder.build({
    instruction: input.instruction,
    room,
    messages,
    sourceMessageId: source.id,
    memories: relevant,
  });
  const reply = await runtime.send(session.id, source.content, context);
  if (reply.session.id !== session.id || reply.session.status !== 'idle')
    throw new Error('Runtime reply does not match active Session');
  return rooms.append(
    room.id,
    {
      sender: { kind: 'agent', id: session.agentId },
      content: reply.text,
      replyTo: source.id,
      metadata: {
        sessionId: session.id,
        ...(input.taskExecution ? { taskExecution: input.taskExecution } : {}),
      },
    },
    { id: identity.id, createdAt: identity.at },
  );
}
