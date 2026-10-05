import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMemory, memorySearchPhrase } from './domain.js';
import { selectMemories } from './retrieval.js';
import type { MemoryInput, MemoryType } from './domain.js';
import { SqliteMemoryProvider } from './sqlite.js';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { captureMemory } from './service.js';
export type MemoryCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'capture'; readonly input: MemoryInput }
  | { readonly action: 'get'; readonly id: string }
  | {
      readonly action: 'list' | 'search';
      readonly query?: string;
      readonly scope?: string;
      readonly at?: number;
      readonly type?: MemoryType;
      readonly tag?: string;
      readonly entity?: string;
    }
  | { readonly action: 'invalidate'; readonly id: string; readonly reason: string }
);
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return value;
}
function memoryTime(value: string): number {
  const date = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value
  )
    throw new Error('Memory time requires canonical millisecond UTC ISO');
  return date.getTime();
}
function memoryType(value: string | undefined): MemoryType {
  if (
    value === 'semantic' ||
    value === 'episodic' ||
    value === 'procedural' ||
    value === 'relational'
  )
    return value;
  throw new Error('Invalid Memory type');
}
export function parseMemoryCommand(argv: string[]): MemoryCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      type: { type: 'string' },
      scope: { type: 'string' },
      content: { type: 'string' },
      confidence: { type: 'string' },
      room: { type: 'string' },
      message: { type: 'string' },
      supersedes: { type: 'string' },
      reason: { type: 'string' },
      'valid-from': { type: 'string' },
      'valid-until': { type: 'string' },
      at: { type: 'string' },
      tag: { type: 'string', multiple: true },
      entity: { type: 'string', multiple: true },
      importance: { type: 'string' },
    },
  });
  const [noun, action, id, ...extra] = parsed.positionals;
  if (noun !== 'memory' || extra.length) throw new Error('Expected Memory command');
  const base = {
    db: required(parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'), 'DB'),
    json: parsed.values.json ?? false,
  };
  const allowed =
    action === 'capture'
      ? [
          'db',
          'json',
          'type',
          'scope',
          'content',
          'confidence',
          'room',
          'message',
          'supersedes',
          'valid-from',
          'valid-until',
          'tag',
          'entity',
          'importance',
        ]
      : action === 'list' || action === 'search'
        ? ['db', 'json', 'scope', 'at', 'type', 'tag', 'entity']
        : action === 'invalidate'
          ? ['db', 'json', 'reason']
          : ['db', 'json'];
  for (const key of Object.keys(parsed.values))
    if (!allowed.includes(key)) throw new Error(`Unexpected --${key}`);
  if (action === 'capture') {
    if (id !== undefined) throw new Error('Unexpected capture argument');
    const input: MemoryInput = {
      ...(parsed.values.tag === undefined ? {} : { tags: parsed.values.tag }),
      ...(parsed.values.entity === undefined ? {} : { entities: parsed.values.entity }),
      ...(parsed.values.importance === undefined
        ? {}
        : { importance: Number(required(parsed.values.importance, 'importance')) }),
      type: memoryType(parsed.values.type),
      scope: required(parsed.values.scope, 'scope'),
      content: required(parsed.values.content, 'content'),
      confidence: Number(required(parsed.values.confidence, 'confidence')),
      sourceRefs: [
        {
          roomId: required(parsed.values.room, 'room'),
          messageId: required(parsed.values.message, 'message'),
        },
      ],
      ...(parsed.values['valid-from'] === undefined
        ? {}
        : { validFrom: memoryTime(parsed.values['valid-from']) }),
      ...(parsed.values['valid-until'] === undefined
        ? {}
        : { validUntil: memoryTime(parsed.values['valid-until']) }),
      ...(parsed.values.supersedes === undefined ? {} : { supersedes: parsed.values.supersedes }),
    };
    createMemory(input, { id: 'validation', at: 'validation' });
    return { ...base, action, input };
  }
  if (action === 'get') return { ...base, action, id: required(id, 'ID') };
  if (action === 'invalidate')
    return {
      ...base,
      action,
      id: required(id, 'ID'),
      reason: required(parsed.values.reason, 'reason'),
    };
  if ((action === 'list' && id === undefined) || action === 'search') {
    const query = action === 'search' ? required(id, 'QUERY') : undefined;
    if (query !== undefined) memorySearchPhrase(query);
    if ((parsed.values.tag?.length ?? 0) > 1 || (parsed.values.entity?.length ?? 0) > 1)
      throw new Error('Memory list accepts one --tag/--entity filter');
    return {
      ...(query === undefined ? {} : { query }),
      ...(parsed.values.type === undefined ? {} : { type: memoryType(parsed.values.type) }),
      ...(parsed.values.tag?.[0] === undefined
        ? {}
        : { tag: required(parsed.values.tag[0], 'tag') }),
      ...(parsed.values.entity?.[0] === undefined
        ? {}
        : { entity: required(parsed.values.entity[0], 'entity') }),
      ...base,
      action,
      ...(parsed.values.at === undefined ? {} : { at: memoryTime(parsed.values.at) }),
      ...(parsed.values.scope === undefined
        ? {}
        : { scope: required(parsed.values.scope, 'scope') }),
    };
  }
  throw new Error('Expected memory capture|get|list|search|invalidate');
}
export function runMemoryCommand(command: MemoryCommand, output: (line: string) => void): void {
  const provider = new SqliteMemoryProvider(command.db);
  try {
    let result: unknown;
    switch (command.action) {
      case 'capture': {
        const rooms = new SqliteRoomRepository(command.db);
        try {
          result = captureMemory(provider, rooms, command.input, {
            id: randomUUID(),
            at: new Date().toISOString(),
          });
        } finally {
          rooms.close();
        }
        break;
      }
      case 'get':
        result = provider.get(command.id);
        break;
      case 'list':
      case 'search': {
        const scopes = command.scope === undefined ? undefined : [command.scope];
        const records =
          command.action === 'search'
            ? provider.search(required(command.query, 'QUERY'), scopes)
            : provider.list(scopes);
        const at = command.action === 'search' ? (command.at ?? Date.now()) : command.at;
        result = selectMemories(records, {
          ...(at === undefined ? {} : { at }),
          ...(command.type === undefined ? {} : { type: command.type }),
          ...(command.tag === undefined ? {} : { tag: command.tag }),
          ...(command.entity === undefined ? {} : { entity: command.entity }),
        });
        break;
      }
      case 'invalidate':
        result = provider.invalidate(command.id, command.reason, new Date().toISOString());
        break;
    }
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    provider.close();
  }
}
