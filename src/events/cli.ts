import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { jsonObject, validateEventInput, validateSubscriptionInput } from './domain.js';
import type { EventInput, SubscriptionInput } from './domain.js';
import { matchingSubscriptions, publishEvent, registerSubscription } from './service.js';
import { SqliteEventBus } from './sqlite.js';
import { importGithubEvents, validateGithubRepository } from './github.js';
export type EventCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'publish'; readonly input: EventInput }
  | { readonly action: 'import-github'; readonly repository: string }
  | { readonly action: 'subscribe'; readonly input: SubscriptionInput }
  | { readonly action: 'list' | 'subscriptions' }
  | { readonly action: 'get' | 'matches' | 'enable' | 'disable'; readonly id: string }
);
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return value;
}
function subscriberType(value: string | undefined): 'agent' | 'workflow' {
  if (value === 'agent' || value === 'workflow') return value;
  throw new Error('Expected --subscriber-type agent|workflow');
}
export function parseEventCommand(argv: string[]): EventCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      source: { type: 'string' },
      payload: { type: 'string' },
      'subscriber-type': { type: 'string' },
      subscriber: { type: 'string' },
      filter: { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (noun !== 'event' || extra.length) throw new Error('Expected Event command');
  const base = {
    db: parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db'),
    json: parsed.values.json ?? false,
  };
  required(base.db, '--db');
  const allowed =
    action === 'publish'
      ? ['db', 'json', 'source', 'payload']
      : action === 'subscribe'
        ? ['db', 'json', 'subscriber-type', 'subscriber', 'filter']
        : ['db', 'json'];
  for (const key of Object.keys(parsed.values))
    if (!allowed.includes(key)) throw new Error(`Unexpected --${key}`);
  if (action === 'publish') {
    const input = {
      type: required(target, 'Event type'),
      source: required(parsed.values.source, '--source'),
      payload: jsonObject(JSON.parse(parsed.values.payload ?? '{}')),
    };
    validateEventInput(input);
    return { ...base, action, input };
  }
  if (action === 'import-github')
    return {
      ...base,
      action,
      repository: validateGithubRepository(required(target, 'OWNER/REPO')),
    };
  if (action === 'subscribe') {
    const input = {
      subscriberType: subscriberType(parsed.values['subscriber-type']),
      subscriberId: required(parsed.values.subscriber, '--subscriber'),
      eventPattern: required(target, 'Event pattern'),
      filter: jsonObject(JSON.parse(parsed.values.filter ?? '{}')),
    };
    validateSubscriptionInput(input);
    return { ...base, action, input };
  }
  if (action === 'list' || action === 'subscriptions') {
    if (target !== undefined) throw new Error('Unexpected Event argument');
    return { ...base, action };
  }
  if (action === 'get' || action === 'matches' || action === 'enable' || action === 'disable')
    return { ...base, action, id: required(target, 'ID') };
  throw new Error(
    'Expected event publish|import-github|get|list|subscribe|subscriptions|matches|enable|disable',
  );
}
export async function runEventCommand(
  command: EventCommand,
  output: (line: string) => void = console.log,
): Promise<void> {
  const bus = new SqliteEventBus(command.db);
  try {
    const identity = { id: randomUUID(), createdAt: new Date().toISOString() };
    let result: unknown;
    switch (command.action) {
      case 'import-github':
        result = await importGithubEvents(bus, (url, init) => fetch(url, init), command.repository);
        break;
      case 'publish':
        result = publishEvent(bus, command.input, identity);
        break;
      case 'list':
        result = bus.list();
        break;
      case 'get':
        result = bus.get(command.id);
        break;
      case 'subscriptions':
        result = bus.subscriptions();
        break;
      case 'matches':
        result = matchingSubscriptions(bus, command.id);
        break;
      case 'enable':
        result = bus.setEnabled(command.id, true);
        break;
      case 'disable':
        result = bus.setEnabled(command.id, false);
        break;
      case 'subscribe': {
        const agents = new SqliteAgentRepository(command.db);
        try {
          result = registerSubscription(bus, agents, command.input, identity);
        } finally {
          agents.close();
        }
        break;
      }
    }
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    bus.close();
  }
}
