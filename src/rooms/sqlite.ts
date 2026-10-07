import type { AuditActor, AuditEntry } from '../audit/domain.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { archiveRoom, createMessage, createRoom, validateActivationRules } from './domain.js';
import type { Identity, JsonValue, Message, MessageInput, Participant, Room } from './domain.js';
import type { RoomRepository } from './port.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored Room string');
  return value;
}
function participant(value: unknown): Participant {
  if (!record(value) || (value.kind !== 'human' && value.kind !== 'agent'))
    throw new Error('Invalid stored participant');
  return { kind: value.kind, id: text(value.id) };
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}
function parse(raw: unknown): Record<string, unknown> {
  const value: unknown = JSON.parse(text(raw));
  if (!record(value)) throw new Error('Invalid stored Room record');
  return value;
}
function decodeRoom(raw: unknown): Room {
  const v = parse(raw);
  if (
    (v.type !== 'direct' && v.type !== 'group' && v.type !== 'agent' && v.type !== 'task') ||
    !Array.isArray(v.participants) ||
    (v.activationPolicy !== 'mention_only' &&
      v.activationPolicy !== 'coordinator' &&
      v.activationPolicy !== 'all' &&
      v.activationPolicy !== 'rule_based')
  )
    throw new Error('Invalid stored Room');
  const taskId = nullable(v.taskId);
  const room = createRoom(
    {
      title: text(v.title),
      type: v.type,
      activationPolicy: v.activationPolicy,
      participants: v.participants.map((p: unknown) => participant(p)),
      ...(v.activationRules === undefined
        ? {}
        : {
            activationRules: validateActivationRules(
              v.activationRules,
              v.participants.map((p: unknown) => participant(p)),
            ),
          }),
      ...(v.coordinatorId === undefined ? {} : { coordinatorId: text(v.coordinatorId) }),
      ...(taskId === null ? {} : { taskId }),
    },
    { id: text(v.id), createdAt: text(v.createdAt) },
  );
  return { ...room, archivedAt: nullable(v.archivedAt) };
}
function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => jsonValue(item));
  if (record(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error('Invalid JSON metadata');
}
export function metadataValue(value: unknown): { readonly [key: string]: JsonValue } {
  if (!record(value)) throw new Error('Metadata must be a JSON object');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
}
function decodeMessage(raw: unknown): Message {
  const v = parse(raw);
  return {
    id: text(v.id),
    roomId: text(v.roomId),
    sender: participant(v.sender),
    content: text(v.content),
    replyTo: nullable(v.replyTo),
    metadata: metadataValue(v.metadata),
    createdAt: text(v.createdAt),
  };
}
export class SqliteRoomRepository implements RoomRepository {
  private readonly db: Database;
  constructor(
    path: string,
    private readonly auditActor: AuditActor = { kind: 'system', id: 'unspecified' },
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS room_operation_history(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TRIGGER IF NOT EXISTS room_operations_no_replace BEFORE INSERT ON room_operation_history WHEN EXISTS(SELECT 1 FROM room_operation_history WHERE id=NEW.id OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT,'Room operation immutable');END;
        CREATE TRIGGER IF NOT EXISTS room_operations_no_update BEFORE UPDATE ON room_operation_history BEGIN SELECT RAISE(ABORT,'Room operation immutable');END;
        CREATE TRIGGER IF NOT EXISTS room_operations_no_delete BEFORE DELETE ON room_operation_history BEGIN SELECT RAISE(ABORT,'Room operation immutable');END;
        CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS room_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, room_id TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS room_messages_room ON room_messages(room_id, sequence);
        CREATE TRIGGER IF NOT EXISTS room_messages_no_replace BEFORE INSERT ON room_messages WHEN EXISTS(SELECT 1 FROM room_messages WHERE id=NEW.id OR sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT, 'Messages are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS room_messages_no_update BEFORE UPDATE ON room_messages BEGIN SELECT RAISE(ABORT, 'Messages are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS room_messages_no_delete BEFORE DELETE ON room_messages BEGIN SELECT RAISE(ABORT, 'Messages are immutable'); END;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  create(room: Room): Room {
    return this.transaction(() => {
      this.db.query('INSERT INTO rooms(id, data) VALUES (?, ?)').run(room.id, JSON.stringify(room));
      this.appendOperation('room.create', null, room, room.createdAt);
      return room;
    });
  }
  get(id: string): Room {
    const row = this.db.query('SELECT data FROM rooms WHERE id=?').get(id);
    if (!record(row)) throw new Error('Room not found');
    return decodeRoom(row.data);
  }
  list(): readonly Room[] {
    return this.db
      .query('SELECT data FROM rooms ORDER BY id')
      .all()
      .map((row) => {
        if (!record(row)) throw new Error('Invalid stored Room');
        return decodeRoom(row.data);
      });
  }
  private appendOperation(
    tool: 'room.create' | 'room.archive',
    before: Room | null,
    after: Room,
    at: string,
  ): void {
    const actor = this.auditActor;
    if (
      !['human', 'agent', 'system'].includes(actor.kind) ||
      !actor.id.trim() ||
      actor.id.includes('\0') ||
      actor.id.length > 128
    )
      throw new Error('Invalid Room Audit actor');
    const id = 'room:operation:' + encodeURIComponent(after.id) + ':' + tool;
    const ref = 'org://room-operations/' + encodeURIComponent(id);
    const entry: AuditEntry = {
      id,
      causalId: 'org://rooms/' + encodeURIComponent(after.id),
      actor,
      taskId: after.taskId,
      eventId: null,
      tool,
      inputRef: ref + '/input',
      outputRef: ref + '/output',
      at,
      result: 'succeeded',
      approvalId: null,
    };
    this.db
      .query('INSERT INTO room_operation_history(id,data) VALUES(?,?)')
      .run(id, JSON.stringify({ entry, input: before ?? after, output: after }));
  }
  operationHistory(): readonly AuditEntry[] {
    const operations = this.db
      .query<{ data: string }, []>('SELECT data FROM room_operation_history ORDER BY rowid')
      .all()
      .map((row) => (JSON.parse(row.data) as { entry: AuditEntry }).entry);
    const byRoom = Map.groupBy(operations, (entry) => entry.causalId);
    return this.list().flatMap((room) => {
      const causalId = 'org://rooms/' + encodeURIComponent(room.id);
      const own = byRoom.get(causalId) ?? [];
      return [
        ...own.filter((entry) => entry.tool === 'room.create'),
        ...this.messages(room.id).map((message) => {
          const ref = causalId + '/messages/' + encodeURIComponent(message.id);
          const entry: AuditEntry = {
            id: 'room:message:' + encodeURIComponent(message.id),
            causalId,
            actor: message.sender,
            taskId: room.taskId,
            eventId: null,
            tool: 'room.message',
            inputRef: ref,
            outputRef: ref,
            at: message.createdAt,
            result: 'succeeded',
            approvalId: null,
          };
          return entry;
        }),
        ...own.filter((entry) => entry.tool === 'room.archive'),
      ];
    });
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  archive(id: string, archivedAt: string): Room {
    return this.transaction(() => {
      const before = this.get(id);
      const room = archiveRoom(before, archivedAt);
      if (before.archivedAt !== null) return before;
      this.db.query('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(room), id);
      this.appendOperation('room.archive', before, room, archivedAt);
      return room;
    });
  }
  append(roomId: string, input: MessageInput, identity: Identity): Message {
    return this.transaction(() => {
      let reply: Message | undefined;
      if (input.replyTo !== undefined) {
        const row = this.db.query('SELECT data FROM room_messages WHERE id=?').get(input.replyTo);
        if (record(row)) reply = decodeMessage(row.data);
      }
      const message = createMessage(this.get(roomId), input, identity, reply);
      this.db
        .query('INSERT INTO room_messages(id, room_id, data) VALUES (?, ?, ?)')
        .run(message.id, roomId, JSON.stringify(message));
      return message;
    });
  }
  messages(roomId: string): readonly Message[] {
    this.get(roomId);
    return this.db
      .query('SELECT data FROM room_messages WHERE room_id=? ORDER BY sequence')
      .all(roomId)
      .map((row) => {
        if (!record(row)) throw new Error('Invalid stored Message');
        return decodeMessage(row.data);
      });
  }
}
