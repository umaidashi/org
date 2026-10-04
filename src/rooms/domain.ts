export type RoomType = 'direct' | 'group' | 'agent' | 'task';
export type ActivationPolicy = 'mention_only' | 'coordinator' | 'all' | 'rule_based';
export interface Participant {
  readonly kind: 'human' | 'agent';
  readonly id: string;
}
export interface Room {
  readonly id: string;
  readonly title: string;
  readonly type: RoomType;
  readonly activationPolicy: ActivationPolicy;
  readonly participants: readonly Participant[];
  readonly taskId: string | null;
  readonly coordinatorId?: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}
export interface RoomInput {
  readonly title: string;
  readonly type: RoomType;
  readonly participants: readonly Participant[];
  readonly activationPolicy?: ActivationPolicy;
  readonly taskId?: string;
  readonly coordinatorId?: string;
}
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export interface Message {
  readonly id: string;
  readonly roomId: string;
  readonly sender: Participant;
  readonly content: string;
  readonly replyTo: string | null;
  readonly metadata: { readonly [key: string]: JsonValue };
  readonly createdAt: string;
}
export interface MessageInput {
  readonly sender: Participant;
  readonly content: string;
  readonly replyTo?: string;
  readonly metadata?: { readonly [key: string]: JsonValue };
}
export interface Identity {
  readonly id: string;
  readonly createdAt: string;
}
function nonempty(value: string): void {
  if (!value.trim()) throw new Error('Room and Message fields must not be empty');
}
function sameParticipant(a: Participant, b: Participant): boolean {
  return a.kind === b.kind && a.id === b.id;
}
export function validateRoomInput(input: RoomInput): void {
  nonempty(input.title);
  const keys = new Set<string>();
  for (const participant of input.participants) {
    nonempty(participant.id);
    const key = `${participant.kind}:${participant.id}`;
    if (keys.has(key)) throw new Error('Duplicate Room participant');
    keys.add(key);
  }
  if (
    input.coordinatorId !== undefined &&
    !input.participants.some((p) => p.kind === 'agent' && p.id === input.coordinatorId)
  )
    throw new Error('Room coordinator must be a participating Agent');
  const humans = input.participants.filter((p) => p.kind === 'human').length;
  const agents = input.participants.filter((p) => p.kind === 'agent').length;
  switch (input.type) {
    case 'direct':
      if (humans !== 1 || agents !== 1)
        throw new Error('Direct Room requires one human and one Agent');
      break;
    case 'group':
      if (humans < 1 || agents < 2)
        throw new Error('Group Room requires human and multiple Agents');
      break;
    case 'agent':
      if (humans !== 0 || agents < 2) throw new Error('Agent Room requires multiple Agents only');
      break;
    case 'task':
      if (!input.taskId || input.participants.length === 0)
        throw new Error('Task Room requires Task and participants');
      nonempty(input.taskId);
      break;
  }
  if (input.type !== 'task' && input.taskId !== undefined)
    throw new Error('Only Task Room can reference a Task');
}
export function createRoom(input: RoomInput, identity: Identity): Room {
  validateRoomInput(input);
  for (const value of [identity.id, identity.createdAt]) nonempty(value);
  return {
    ...identity,
    title: input.title,
    type: input.type,
    activationPolicy: input.activationPolicy ?? 'coordinator',
    participants: input.participants.map((p) => ({ ...p })),
    taskId: input.taskId ?? null,
    archivedAt: null,
    ...(input.coordinatorId === undefined ? {} : { coordinatorId: input.coordinatorId }),
  };
}
export function archiveRoom(room: Room, archivedAt: string): Room {
  nonempty(archivedAt);
  return room.archivedAt === null ? { ...room, archivedAt } : room;
}
function copyJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Metadata numbers must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map((entry: JsonValue) => copyJson(entry));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]: [string, JsonValue]) => [key, copyJson(entry)]),
  );
}
export function messageMentions(room: Room, metadata: Message['metadata']): readonly string[] {
  const mentions = metadata.mentions;
  if (mentions === undefined) return [];
  if (!Array.isArray(mentions)) throw new Error('Message mentions must be Agent IDs');
  return mentions.map((id: JsonValue) => {
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      !room.participants.some((p) => p.kind === 'agent' && p.id === id)
    )
      throw new Error('Message mention must be a participating Agent');
    return id;
  });
}
export function createMessage(
  room: Room,
  input: MessageInput,
  identity: Identity,
  reply?: Message,
): Message {
  for (const value of [identity.id, identity.createdAt, input.content, input.sender.id])
    nonempty(value);
  if (room.archivedAt !== null) throw new Error('Room is archived');
  if (!room.participants.some((p) => sameParticipant(p, input.sender)))
    throw new Error('Sender is not a Room participant');
  if (
    input.replyTo !== undefined &&
    (!reply || reply.id !== input.replyTo || reply.roomId !== room.id)
  )
    throw new Error('Reply must reference a Message in the same Room');
  messageMentions(room, input.metadata ?? {});
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).map(([key, value]) => [key, copyJson(value)]),
  );
  return {
    ...identity,
    roomId: room.id,
    sender: { ...input.sender },
    content: input.content,
    replyTo: input.replyTo ?? null,
    metadata,
  };
}
