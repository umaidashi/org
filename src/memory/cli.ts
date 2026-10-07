import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMemory, memorySearchPhrase, taskReviewSource } from './domain.js';
import { selectMemories } from './retrieval.js';
import type { MemoryInput, MemoryType } from './domain.js';
import { SqliteMemoryProvider } from './sqlite.js';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { captureMemory } from './service.js';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
import { SqliteEventBus } from '../events/sqlite.js';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { extractRoomMemories } from './extraction.js';
import { jsonMemoryExtractor } from './extractor.js';
import {
  consolidateRoomMemories,
  validateConsolidationRequest,
  validateConsolidationScope,
  type MemoryConsolidationRequest,
} from './consolidation.js';
export type MemoryCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'capture'; readonly input: MemoryInput }
  | { readonly action: 'extract'; readonly roomId: string; readonly messageId: string }
  | { readonly action: 'consolidate'; readonly request: MemoryConsolidationRequest }
  | { readonly action: 'consolidations'; readonly scope: string }
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
      key: { type: 'string' },
      tag: { type: 'string', multiple: true },
      entity: { type: 'string', multiple: true },
      importance: { type: 'string' },
      'source-review': { type: 'string' },
      'source-event': { type: 'string' },
    },
  });
  const [noun, action, id, ...extra] = parsed.positionals;
  if (noun !== 'memory' || extra.length) throw new Error('Expected Memory command');
  const base = {
    db: required(parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'), 'DB'),
    json: parsed.values.json ?? false,
  };
  const allowed =
    action === 'consolidations'
      ? ['db', 'json', 'scope']
      : action === 'consolidate'
        ? ['db', 'json', 'scope', 'key', 'at']
        : action === 'extract'
          ? ['db', 'json', 'room', 'message']
          : action === 'capture'
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
                'source-review',
                'source-event',
              ]
            : action === 'list' || action === 'search'
              ? ['db', 'json', 'scope', 'at', 'type', 'tag', 'entity']
              : action === 'invalidate'
                ? ['db', 'json', 'reason']
                : ['db', 'json'];
  for (const key of Object.keys(parsed.values))
    if (!allowed.includes(key)) throw new Error(`Unexpected --${key}`);
  if (action === 'consolidations') {
    if (id !== undefined) throw new Error('Unexpected consolidations argument');
    const scope = required(parsed.values.scope, 'scope');
    validateConsolidationScope(scope);
    return { ...base, action, scope };
  }
  if (action === 'consolidate') {
    if (id !== undefined) throw new Error('Unexpected consolidate argument');
    const request = {
      scope: required(parsed.values.scope, 'scope'),
      key: required(parsed.values.key, 'key'),
      at: required(parsed.values.at, 'at'),
    };
    validateConsolidationRequest(request);
    if (request.key.startsWith('nightly-memory:'))
      throw new Error('Nightly consolidation keys are reserved for daemon');
    return { ...base, action, request };
  }
  if (action === 'extract') {
    if (id !== undefined) throw new Error('Unexpected extract argument');
    return {
      ...base,
      action,
      roomId: required(parsed.values.room, 'room'),
      messageId: required(parsed.values.message, 'message'),
    };
  }
  if (action === 'capture') {
    if (id !== undefined) throw new Error('Unexpected capture argument');
    if (
      [
        parsed.values['source-review'] !== undefined,
        parsed.values['source-event'] !== undefined,
        parsed.values.room !== undefined || parsed.values.message !== undefined,
      ].filter(Boolean).length > 1
    )
      throw new Error('Memory source options are mutually exclusive');
    if (parsed.values['source-review'] !== undefined)
      taskReviewSource(parsed.values['source-review']);
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
      sourceRefs:
        parsed.values['source-event'] !== undefined
          ? [
              {
                uri:
                  'org://events/' +
                  encodeURIComponent(required(parsed.values['source-event'], 'source-event')),
              },
            ]
          : parsed.values['source-review'] !== undefined
            ? [{ uri: required(parsed.values['source-review'], 'source-review') }]
            : [
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
  throw new Error(
    'Expected memory capture|extract|consolidate|consolidations|get|list|search|invalidate',
  );
}
export function runMemoryCommand(command: MemoryCommand, output: (line: string) => void): void {
  const provider = new SqliteMemoryProvider(command.db);
  try {
    let result: unknown;
    switch (command.action) {
      case 'consolidations':
        result = provider.listConsolidations(command.scope);
        break;
      case 'consolidate': {
        const rooms = new SqliteRoomRepository(command.db);
        try {
          result = consolidateRoomMemories(rooms, provider, provider, command.request);
        } finally {
          rooms.close();
        }
        break;
      }
      case 'extract': {
        const rooms = new SqliteRoomRepository(command.db);
        let agents: SqliteAgentRepository | undefined;
        try {
          agents = new SqliteAgentRepository(command.db);
          result = extractRoomMemories(rooms, agents, provider, jsonMemoryExtractor, command);
        } finally {
          try {
            agents?.close();
          } finally {
            rooms.close();
          }
        }
        break;
      }
      case 'capture': {
        let rooms: SqliteRoomRepository | undefined;
        let tasks: SqliteTaskProvider | undefined;
        let events: SqliteEventBus | undefined;
        try {
          if (command.input.sourceRefs.some((ref) => 'roomId' in ref))
            rooms = new SqliteRoomRepository(command.db);
          if (
            command.input.sourceRefs.some(
              (ref) => 'uri' in ref && ref.uri.startsWith('org://tasks/'),
            )
          )
            tasks = new SqliteTaskProvider(command.db);
          if (
            command.input.sourceRefs.some(
              (ref) => 'uri' in ref && ref.uri.startsWith('org://events/'),
            )
          )
            events = new SqliteEventBus(command.db);
          result = captureMemory(
            provider,
            rooms,
            command.input,
            {
              id: randomUUID(),
              at: new Date().toISOString(),
            },
            tasks,
            events,
          );
        } finally {
          try {
            rooms?.close();
          } finally {
            try {
              tasks?.close();
            } finally {
              events?.close();
            }
          }
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
