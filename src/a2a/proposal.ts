import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { requireCapability } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { JsonValue, Message } from '../rooms/domain.js';
import { createA2AMessage, isJsonValue, readA2AMessage, type A2AMessage } from './domain.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseDelegationProposal(content: string): {
  readonly to: string;
  readonly payload: JsonValue;
} {
  if (Buffer.byteLength(content, 'utf8') > 65536) throw new Error('Delegation proposal too large');
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('Invalid delegation proposal JSON');
  }
  if (!record(value)) throw new Error('Invalid delegation proposal');
  const object: Record<string, unknown> = value;
  if (
    Object.keys(object).some(
      (key) => !['version', 'tool', 'type', 'to', 'payload'].includes(key),
    ) ||
    object.version !== 1 ||
    object.tool !== 'a2a' ||
    object.type !== 'delegate' ||
    typeof object.to !== 'string' ||
    object.to.trim().length === 0 ||
    !Object.hasOwn(object, 'payload') ||
    !isJsonValue(object.payload)
  )
    throw new Error('Invalid delegation proposal');
  return { to: object.to, payload: object.payload };
}
export function adoptDelegationProposal(
  rooms: Pick<RoomRepository, 'get' | 'messages' | 'append'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: { get(id: string): unknown },
  input: { readonly roomId: string; readonly messageId: string },
): A2AMessage {
  const room = rooms.get(input.roomId);
  if (room.id !== input.roomId || room.archivedAt !== null || room.coordinatorId === undefined)
    throw new Error('Delegation Coordinator Room unavailable');
  const source = rooms
    .messages(room.id)
    .find((m) => m.id === input.messageId && m.roomId === room.id);
  if (
    !source ||
    source.sender.kind !== 'agent' ||
    source.sender.id !== room.coordinatorId ||
    Object.hasOwn(source.metadata, 'a2a') ||
    !room.participants.some((p) => p.kind === 'agent' && p.id === source.sender.id)
  )
    throw new Error('Delegation requires Coordinator original proposal');
  const candidate = parseDelegationProposal(source.content);
  const known = agents.list();
  const sender = known.find((a) => a.id === source.sender.id);
  const target = known.find((a) => a.id === candidate.to);
  if (!sender || !target || target.id === sender.id || target.reportsTo !== sender.id)
    throw new Error('Delegation target must report to Coordinator');
  for (const capability of ['can_read', 'can_write', 'can_delegate'] as const)
    requireCapability(sender, capability);
  if (room.taskId !== null) tasks.get(room.taskId);
  const id =
    'a2a:proposal:' +
    createHash('sha256')
      .update(JSON.stringify([room.id, source.id]))
      .digest('hex');
  const base = createA2AMessage(
    room,
    { from: sender.id, to: target.id, type: 'delegate', payload: candidate.payload },
    { id, createdAt: source.createdAt },
  );
  const planned: Message = {
    ...base,
    metadata: { ...base.metadata, proposalRef: `org://rooms/${room.id}/messages/${source.id}` },
  };
  const verified = (message: Message): A2AMessage => {
    if (!isDeepStrictEqual(message, planned))
      throw new Error('Delegation adoption evidence conflict');
    return readA2AMessage(message);
  };
  const previous = rooms.messages(room.id).find((m) => m.id === id);
  if (previous) return verified(previous);
  let saved: Message;
  try {
    saved = rooms.append(
      room.id,
      { sender: planned.sender, content: planned.content, metadata: planned.metadata },
      { id, createdAt: source.createdAt },
    );
  } catch (error) {
    const concurrent = rooms.messages(room.id).find((m) => m.id === id);
    if (!concurrent) throw error;
    return verified(concurrent);
  }
  return verified(saved);
}
