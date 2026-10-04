import { parseSessionCommand, runSessionCommand } from '../sessions/cli.js';
import type { SessionCommand, SessionContext } from '../sessions/cli.js';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { AgentInput } from '../agents/domain.js';
import { registerAgent } from '../agents/service.js';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { parseTaskCommand, runTaskCommand } from '../tasks/cli.js';
import type { TaskCommand } from '../tasks/cli.js';
import { parseRoomCommand, runRoomCommand } from '../rooms/cli.js';
import type { RoomCommand } from '../rooms/cli.js';
import { parseEventCommand, runEventCommand } from '../events/cli.js';
import type { EventCommand } from '../events/cli.js';

import type { CommandResult } from './port.js';

export const usage = `Usage: org [--db PATH] agent create NAME --role ROLE --runtime RUNTIME
       org [--db PATH] agent list [--json]
       org [--db PATH] task create TITLE --objective OBJECTIVE [--json]
       org [--db PATH] task list|get|assign|update|history [OPTIONS]
       org [--db PATH] room create|list|get|archive|send|messages [OPTIONS]
       org [--db PATH] event publish|get|list|subscribe|subscriptions|matches|enable|disable [OPTIONS]
       org session start|send|resume|reply|stop|get|list|history [OPTIONS]
       org [--db PATH] daemon --once [--json]
       org [--db PATH] daemon deliveries [--json]
       org [--db PATH] daemon [--socket PATH] [--poll-interval MS]
       org daemon status|dispatch|stop --socket PATH [--json]

Register and list persistent Agent identities. Runtime processes are not started.
Default DB: ~/.local/share/org/org.db`;

class UsageError extends Error {}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new UsageError(`Missing ${name}`);
  return value;
}

export type ApplicationCommand =
  | { kind: 'session'; command: SessionCommand }
  | { kind: 'help' }
  | { kind: 'task'; command: TaskCommand }
  | { kind: 'room'; command: RoomCommand }
  | { kind: 'event'; command: EventCommand }
  | { kind: 'create'; db: string; input: AgentInput }
  | { kind: 'list'; db: string; json: boolean };

export function parseApplicationCommand(argv: string[]): ApplicationCommand {
  const probe = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { db: { type: 'string' } },
  });
  if (probe.positionals[0] === 'session')
    return { kind: 'session', command: parseSessionCommand(argv) };
  if (probe.positionals[0] === 'task') return { kind: 'task', command: parseTaskCommand(argv) };
  if (probe.positionals[0] === 'room') return { kind: 'room', command: parseRoomCommand(argv) };
  if (probe.positionals[0] === 'event') return { kind: 'event', command: parseEventCommand(argv) };
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      role: { type: 'string' },
      runtime: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (parsed.values.help) {
    return { kind: 'help' };
  }
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim()) throw new UsageError('The database path must not be empty');
  const [command, action, name, ...extra] = parsed.positionals;
  if (command !== 'agent' || extra.length > 0) throw new UsageError('Expected agent command');
  if (action === 'create') {
    if (parsed.values.json) throw new UsageError('--json is only available for list');
    return {
      kind: 'create',
      db,
      input: {
        name: required(name, 'name'),
        role: required(parsed.values.role, '--role'),
        runtime: required(parsed.values.runtime, '--runtime'),
      },
    };
  } else if (action === 'list') {
    if (
      name !== undefined ||
      parsed.values.role !== undefined ||
      parsed.values.runtime !== undefined
    ) {
      throw new UsageError('Unexpected argument for agent list');
    }
    return { kind: 'list', db, json: parsed.values.json ?? false };
  } else {
    throw new UsageError('Expected agent create or agent list');
  }
}

async function runApplication(
  command: ApplicationCommand,
  db: string,
  output: (line: string) => void,
  sessions?: SessionContext,
): Promise<void> {
  if (command.kind === 'session') {
    if (!sessions) throw new Error('Session commands require daemon');
    output(await runSessionCommand(command.command, sessions));
    return;
  }
  if (command.kind === 'help') {
    output(usage);
    return;
  }
  if (command.kind === 'task') {
    runTaskCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'room') {
    runRoomCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'event') {
    runEventCommand({ ...command.command, db }, output);
    return;
  }
  let repository: SqliteAgentRepository | undefined;
  try {
    repository = new SqliteAgentRepository(db);
    if (command.kind === 'create') {
      const agent = registerAgent(repository, command.input, {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      });
      output(`Created agent ${agent.name} (${agent.id})`);
    } else {
      const agents = repository.list();
      if (command.json) {
        output(
          JSON.stringify(
            agents.map(({ createdAt, ...agent }) => ({ ...agent, created_at: createdAt })),
          ),
        );
      } else if (agents.length === 0) {
        output('No agents registered.');
      } else {
        output('ID\tNAME\tROLE\tRUNTIME');
        for (const agent of agents)
          output(`${agent.id}\t${agent.name}\t${agent.role}\t${agent.runtime}`);
      }
    }
  } finally {
    repository?.close();
  }
}
export async function executeApplication(
  argv: string[],
  db: string,
  remote = false,
  sessions?: SessionContext,
): Promise<CommandResult> {
  let command: ApplicationCommand;
  try {
    if (remote) {
      const probe = parseArgs({
        args: argv,
        strict: false,
        allowPositionals: true,
        options: {
          db: { type: 'string' },
          socket: { type: 'string' },
          direct: { type: 'boolean' },
        },
      });
      if (['db', 'socket', 'direct'].some((name) => Object.hasOwn(probe.values, name)))
        throw new Error('Remote commands cannot change transport or database');
    }
    command = parseApplicationCommand(argv);
  } catch (error) {
    return {
      code: 2,
      stdout: [],
      stderr: [`Error: ${error instanceof Error ? error.message : String(error)}\n${usage}`],
    };
  }
  const stdout: string[] = [];
  try {
    await runApplication(command, db, (line) => stdout.push(line), sessions);
    return { code: 0, stdout, stderr: [] };
  } catch (error) {
    return {
      code: 1,
      stdout,
      stderr: [`Error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
