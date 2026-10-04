import { selectActivationAgents } from '../activation/domain.js';
import { listA2AMessages } from '../a2a/service.js';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
import type { ActivationPolicy, MessageInput, RoomInput, RoomType } from './domain.js';
import { validateRoomInput } from './domain.js';
import { registerRoom } from './service.js';
import { metadataValue, SqliteRoomRepository } from './sqlite.js';

export type RoomCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'create'; readonly input: RoomInput }
  | { readonly action: 'list' }
  | { readonly action: 'targets'; readonly id: string; readonly messageId: string }
  | { readonly action: 'get' | 'archive' | 'messages'; readonly id: string }
  | { readonly action: 'send'; readonly id: string; readonly input: MessageInput }
);
function required(value: string | undefined, name: string): string {
  if (value === undefined || !value.trim()) throw new Error(`Missing ${name}`);
  return value;
}
function roomType(value: string | undefined): RoomType {
  if (value === 'direct' || value === 'group' || value === 'agent' || value === 'task')
    return value;
  throw new Error('Expected --type direct|group|agent|task');
}
function policy(value: string | undefined): ActivationPolicy {
  if (value === undefined) return 'coordinator';
  if (
    value === 'coordinator' ||
    value === 'mention_only' ||
    value === 'all' ||
    value === 'rule_based'
  )
    return value;
  throw new Error('Invalid --activation-policy');
}
export function parseRoomCommand(argv: string[]): RoomCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      type: { type: 'string' },
      coordinator: { type: 'string' },
      mention: { type: 'string', multiple: true },
      message: { type: 'string' },
      'activation-policy': { type: 'string' },
      human: { type: 'string', multiple: true },
      agent: { type: 'string', multiple: true },
      task: { type: 'string' },
      content: { type: 'string' },
      'reply-to': { type: 'string' },
      metadata: { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (noun !== 'room' || extra.length) throw new Error('Expected Room command');
  const base = {
    db: parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'),
    json: parsed.values.json ?? false,
  };
  required(base.db, '--db');
  const allowed =
    action === 'create'
      ? ['db', 'json', 'type', 'activation-policy', 'human', 'agent', 'task', 'coordinator']
      : action === 'send'
        ? ['db', 'json', 'human', 'agent', 'content', 'reply-to', 'metadata', 'mention']
        : action === 'targets'
          ? ['db', 'json', 'message']
          : ['db', 'json'];
  for (const key of Object.keys(parsed.values))
    if (!allowed.includes(key)) throw new Error(`Unexpected --${key} for room ${action}`);
  if (action === 'targets')
    return {
      ...base,
      action,
      id: required(target, 'Room ID'),
      messageId: required(parsed.values.message, 'Message ID'),
    };
  if (action === 'list') {
    if (target !== undefined) throw new Error('Unexpected argument for room list');
    return { ...base, action };
  }
  if (action === 'create') {
    const command: RoomCommand = {
      ...base,
      action,
      input: {
        title: required(target, 'title'),
        ...(parsed.values.coordinator === undefined
          ? {}
          : { coordinatorId: required(parsed.values.coordinator, 'coordinator') }),
        type: roomType(parsed.values.type),
        activationPolicy: policy(parsed.values['activation-policy']),
        participants: [
          ...(parsed.values.human ?? []).map((id) => ({ kind: 'human' as const, id })),
          ...(parsed.values.agent ?? []).map((id) => ({ kind: 'agent' as const, id })),
        ],
        ...(parsed.values.task === undefined ? {} : { taskId: parsed.values.task }),
      },
    };
    validateRoomInput(command.input);
    return command;
  }
  if (action === 'get' || action === 'archive' || action === 'messages')
    return { ...base, action, id: required(target, 'Room ID') };
  if (action === 'send') {
    const humans = parsed.values.human ?? [];
    const agents = parsed.values.agent ?? [];
    if (humans.length + agents.length !== 1)
      throw new Error('Expected exactly one --human or --agent sender');
    const metadata = metadataValue(JSON.parse(parsed.values.metadata ?? '{}'));
    if (parsed.values.mention !== undefined && 'mentions' in metadata)
      throw new Error('Choose --mention or metadata.mentions');
    return {
      ...base,
      action,
      id: required(target, 'Room ID'),
      input: {
        sender: humans.length
          ? { kind: 'human', id: required(humans[0], '--human') }
          : { kind: 'agent', id: required(agents[0], '--agent') },
        content: required(parsed.values.content, '--content'),
        ...(parsed.values['reply-to'] === undefined ? {} : { replyTo: parsed.values['reply-to'] }),
        metadata: {
          ...metadata,
          ...(parsed.values.mention === undefined
            ? {}
            : { mentions: parsed.values.mention.map((id) => required(id, 'mention')) }),
        },
      },
    };
  }
  throw new Error('Expected room create|list|get|archive|send|messages|targets');
}
export function runRoomCommand(
  command: RoomCommand,
  output: (line: string) => void = console.log,
): void {
  const rooms = new SqliteRoomRepository(command.db);
  try {
    const identity = { id: randomUUID(), createdAt: new Date().toISOString() };
    let result: unknown;
    switch (command.action) {
      case 'create': {
        const agents = new SqliteAgentRepository(command.db);
        let tasks: SqliteTaskProvider | undefined;
        try {
          tasks = new SqliteTaskProvider(command.db);
          result = registerRoom(rooms, agents, tasks, command.input, identity);
        } finally {
          tasks?.close();
          agents.close();
        }
        break;
      }
      case 'targets': {
        const room = rooms.get(command.id);
        const message = rooms.messages(command.id).find((m) => m.id === command.messageId);
        if (!message) throw new Error('Activation Message not found in Room');
        if ('a2a' in message.metadata) {
          const tasks = new SqliteTaskProvider(command.db);
          try {
            listA2AMessages(rooms, command.id, tasks);
          } finally {
            tasks.close();
          }
        }
        result = selectActivationAgents(room, message);
        break;
      }
      case 'list':
        result = rooms.list();
        break;
      case 'get':
        result = rooms.get(command.id);
        break;
      case 'archive':
        result = rooms.archive(command.id, identity.createdAt);
        break;
      case 'send':
        result = rooms.append(command.id, command.input, identity);
        break;
      case 'messages':
        result = rooms.messages(command.id);
        break;
    }
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    rooms.close();
  }
}
