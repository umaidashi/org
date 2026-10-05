import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSchedule } from './domain.js';
import type { ScheduleInput } from './domain.js';
import { SqliteScheduleRepository } from './sqlite.js';
import { jsonObject } from '../events/domain.js';
export type ScheduleCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'create'; readonly input: ScheduleInput }
  | { readonly action: 'list' }
  | { readonly action: 'get' | 'enable' | 'disable'; readonly id: string }
);
function required(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`Missing ${field}`);
  return value;
}
export function parseScheduleCommand(argv: string[]): ScheduleCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      'every-ms': { type: 'string' },
      'start-at': { type: 'string' },
      event: { type: 'string' },
      payload: { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (noun !== 'schedule' || extra.length) throw new Error('Expected Schedule command');
  const base = {
    db: parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'),
    json: parsed.values.json ?? false,
  };
  required(base.db, '--db');
  const allowed =
    action === 'create'
      ? ['db', 'json', 'every-ms', 'start-at', 'event', 'payload']
      : ['db', 'json'];
  for (const key of Object.keys(parsed.values))
    if (!allowed.includes(key)) throw new Error(`Unexpected --${key}`);
  if (action === 'create') {
    const rawStart = required(parsed.values['start-at'], '--start-at');
    const startAtMs = Date.parse(rawStart);
    if (!Number.isFinite(startAtMs) || new Date(startAtMs).toISOString() !== rawStart)
      throw new Error('Expected canonical UTC ISO --start-at');
    const input = {
      name: required(target, 'name'),
      everyMs: Number(required(parsed.values['every-ms'], '--every-ms')),
      startAtMs,
      event: {
        type: required(parsed.values.event, '--event'),
        source: 'scheduler',
        payload: jsonObject(JSON.parse(parsed.values.payload ?? '{}')),
      },
    };
    createSchedule(input, { id: 'validate', createdAt: 'validate' });
    return { ...base, action, input };
  }
  if (action === 'list') {
    if (target !== undefined) throw new Error('Unexpected Schedule argument');
    return { ...base, action };
  }
  if (action === 'get' || action === 'enable' || action === 'disable')
    return { ...base, action, id: required(target, 'Schedule ID') };
  throw new Error('Expected schedule create|list|get|enable|disable');
}
export function runScheduleCommand(command: ScheduleCommand, output: (line: string) => void): void {
  const schedules = new SqliteScheduleRepository(command.db);
  try {
    const result =
      command.action === 'create'
        ? schedules.create(
            createSchedule(command.input, {
              id: randomUUID(),
              createdAt: new Date().toISOString(),
            }),
          )
        : command.action === 'list'
          ? schedules.list()
          : command.action === 'get'
            ? schedules.get(command.id)
            : schedules.setEnabled(command.id, command.action === 'enable');
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    schedules.close();
  }
}
