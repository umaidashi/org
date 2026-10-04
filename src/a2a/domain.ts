import { createMessage } from '../rooms/domain.js';
import type { Message, Room, JsonValue, Identity } from '../rooms/domain.js';
export const a2aTypes = [
  'delegate',
  'request',
  'result',
  'question',
  'decision',
  'blocker',
  'cancel',
] as const;
export type A2AType = (typeof a2aTypes)[number];
export interface A2AInput {
  readonly from: string;
  readonly to: string;
  readonly type: A2AType;
  readonly payload: JsonValue;
  readonly taskId?: string;
  readonly correlationId?: string;
  readonly replyTo?: string;
}
export interface A2AMessage {
  readonly id: string;
  readonly roomId: string;
  readonly from: string;
  readonly to: string;
  readonly type: A2AType;
  readonly payload: JsonValue;
  readonly taskId: string | null;
  readonly correlationId: string;
  readonly replyTo: string | null;
  readonly createdAt: string;
}
export function isA2AType(value: unknown): value is A2AType {
  return typeof value === 'string' && a2aTypes.some((type) => type === value);
}
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => isJsonValue(item));
  if (typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((item: unknown) => isJsonValue(item))
  );
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}
export function readA2AMessage(message: Message): A2AMessage {
  const value = message.metadata.a2a;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== 1 ||
    !('type' in value) ||
    !isA2AType(value.type) ||
    !('from' in value) ||
    !nonempty(value.from) ||
    !('to' in value) ||
    !nonempty(value.to) ||
    !('taskId' in value) ||
    (value.taskId !== null && !nonempty(value.taskId)) ||
    !('correlationId' in value) ||
    !nonempty(value.correlationId) ||
    !('payload' in value) ||
    !isJsonValue(value.payload) ||
    message.sender.kind !== 'agent' ||
    message.sender.id !== value.from
  )
    throw new Error('Invalid A2A Message envelope');
  return {
    id: message.id,
    roomId: message.roomId,
    from: value.from,
    to: value.to,
    type: value.type,
    payload: value.payload,
    taskId: value.taskId,
    correlationId: value.correlationId,
    replyTo: message.replyTo,
    createdAt: message.createdAt,
  };
}
export function validateA2AReply(reply: A2AMessage, parent: A2AMessage): void {
  if (
    reply.replyTo !== parent.id ||
    reply.roomId !== parent.roomId ||
    reply.from !== parent.to ||
    reply.to !== parent.from ||
    reply.correlationId !== parent.correlationId ||
    (parent.taskId !== null && reply.taskId !== parent.taskId)
  )
    throw new Error('Invalid A2A reply reference');
}
export function createA2AMessage(
  room: Room,
  input: A2AInput,
  identity: Identity,
  reply?: Message,
): Message {
  if (
    !isA2AType(input.type) ||
    !nonempty(input.from) ||
    !nonempty(input.to) ||
    !isJsonValue(input.payload)
  )
    throw new Error('Invalid A2A input');
  for (const id of [input.from, input.to])
    if (
      !room.participants.some(
        (participant) => participant.kind === 'agent' && participant.id === id,
      )
    )
      throw new Error('A2A endpoints must be Room Agents');
  let taskId = input.taskId ?? room.taskId;
  let correlationId = input.correlationId ?? identity.id;
  if ((taskId !== null && !nonempty(taskId)) || !nonempty(correlationId))
    throw new Error('Invalid A2A reference');
  if (input.replyTo !== undefined) {
    if (!reply || reply.id !== input.replyTo || reply.roomId !== room.id)
      throw new Error('A2A reply must stay in the Room');
    const parent = readA2AMessage(reply);
    if (input.from !== parent.to || input.to !== parent.from)
      throw new Error('A2A reply endpoints must reverse the original');
    if (input.correlationId !== undefined && input.correlationId !== parent.correlationId)
      throw new Error('A2A correlation conflict');
    if (parent.taskId !== null && input.taskId !== undefined && input.taskId !== parent.taskId)
      throw new Error('A2A Task reference conflict');
    taskId = input.taskId ?? parent.taskId ?? room.taskId;
    correlationId = parent.correlationId;
  }
  if (room.taskId !== null && taskId !== room.taskId)
    throw new Error('A2A Task Room reference conflict');
  const envelope = {
    version: 1,
    from: input.from,
    to: input.to,
    type: input.type,
    payload: input.payload,
    taskId,
    correlationId,
  };
  return createMessage(
    room,
    {
      sender: { kind: 'agent', id: input.from },
      content: JSON.stringify(envelope),
      metadata: { a2a: envelope },
      ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
    },
    identity,
    reply,
  );
}
