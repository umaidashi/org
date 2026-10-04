import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isA2AType, isJsonValue } from './domain.js';
import type { A2AInput } from './domain.js';
import { listA2AMessages, sendA2AMessage } from './service.js';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
export type A2ACommand = {
  readonly db: string;
  readonly json: boolean;
  readonly roomId: string;
} & (
  | { readonly action: 'send'; readonly input: A2AInput }
  | { readonly action: 'list' }
  | { readonly action: 'get'; readonly id: string }
);
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return value;
}
export function parseA2ACommand(argv: string[]): A2ACommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      from: { type: 'string' },
      to: { type: 'string' },
      type: { type: 'string' },
      payload: { type: 'string' },
      task: { type: 'string' },
      correlation: { type: 'string' },
      'reply-to': { type: 'string' },
    },
  });
  const [noun, action, roomId, id, ...extra] = parsed.positionals;
  if (noun !== 'a2a' || extra.length) throw new Error('Expected A2A command');
  const base = {
    db: required(parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'), 'DB'),
    json: parsed.values.json ?? false,
    roomId: required(roomId, 'Room ID'),
  };
  const allowed =
    action === 'send'
      ? ['db', 'json', 'from', 'to', 'type', 'payload', 'task', 'correlation', 'reply-to']
      : ['db', 'json'];
  for (const key of Object.keys(parsed.values))
    if (!allowed.includes(key)) throw new Error(`Unexpected --${key}`);
  if (action === 'get') return { ...base, action, id: required(id, 'Message ID') };
  if (id !== undefined) throw new Error('Unexpected A2A argument');
  if (action === 'list') return { ...base, action };
  if (action !== 'send') throw new Error('Expected a2a send|get|list');
  const type = parsed.values.type;
  if (!isA2AType(type)) throw new Error('Invalid A2A type');
  const payload: unknown = JSON.parse(required(parsed.values.payload, 'payload'));
  if (!isJsonValue(payload)) throw new Error('Expected finite JSON payload');
  return {
    ...base,
    action,
    input: {
      from: required(parsed.values.from, 'from'),
      to: required(parsed.values.to, 'to'),
      type,
      payload,
      ...(parsed.values.task === undefined
        ? {}
        : { taskId: required(parsed.values.task, 'Task ID') }),
      ...(parsed.values.correlation === undefined
        ? {}
        : { correlationId: required(parsed.values.correlation, 'correlation') }),
      ...(parsed.values['reply-to'] === undefined
        ? {}
        : { replyTo: required(parsed.values['reply-to'], 'reply-to') }),
    },
  };
}
export function runA2ACommand(command: A2ACommand, output: (line: string) => void): void {
  const rooms = new SqliteRoomRepository(command.db);
  let tasks: SqliteTaskProvider | undefined;
  let agents: SqliteAgentRepository | undefined;
  try {
    tasks = new SqliteTaskProvider(command.db);
    let result: unknown;
    if (command.action === 'send') {
      agents = new SqliteAgentRepository(command.db);
      result = sendA2AMessage(rooms, agents, tasks, command.roomId, command.input, {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      });
    } else {
      const messages = listA2AMessages(rooms, command.roomId, tasks);
      if (command.action === 'list') result = messages;
      else {
        result = messages.find((message) => message.id === command.id);
        if (result === undefined) throw new Error('A2A Message not found');
      }
    }
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    agents?.close();
    tasks?.close();
    rooms.close();
  }
}
