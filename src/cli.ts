#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { AgentInput } from './agents/domain.js';
import { registerAgent } from './agents/service.js';
import { SqliteAgentRepository } from './agents/sqlite.js';
import { parseTaskCommand, runTaskCommand } from './tasks/cli.js';
import type { TaskCommand } from './tasks/cli.js';

const usage = `Usage: org [--db PATH] agent create NAME --role ROLE --runtime RUNTIME
       org [--db PATH] agent list [--json]
       org [--db PATH] task create TITLE --objective OBJECTIVE [--json]
       org [--db PATH] task list|get|assign|update|history [OPTIONS]

Register and list persistent Agent identities. Runtime processes are not started.
Default DB: ~/.local/share/org/org.db`;

class UsageError extends Error {}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new UsageError(`Missing ${name}`);
  return value;
}

type Command =
  | { kind: 'help' }
  | { kind: 'task'; command: TaskCommand }
  | { kind: 'create'; db: string; input: AgentInput }
  | { kind: 'list'; db: string; json: boolean };

function parseCommand(argv: string[]): Command {
  const probe = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { db: { type: 'string' } },
  });
  if (probe.positionals[0] === 'task') return { kind: 'task', command: parseTaskCommand(argv) };
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

export function main(argv: string[]): number {
  let command: Command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 2;
  }
  if (command.kind === 'help') {
    console.log(usage);
    return 0;
  }
  if (command.kind === 'task') {
    try {
      runTaskCommand(command.command);
      return 0;
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  let repository: SqliteAgentRepository | undefined;
  try {
    repository = new SqliteAgentRepository(command.db);
    if (command.kind === 'create') {
      const agent = registerAgent(repository, command.input, {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      });
      console.log(`Created agent ${agent.name} (${agent.id})`);
    } else {
      const agents = repository.list();
      if (command.json) {
        console.log(
          JSON.stringify(
            agents.map(({ createdAt, ...agent }) => ({ ...agent, created_at: createdAt })),
          ),
        );
      } else if (agents.length === 0) {
        console.log('No agents registered.');
      } else {
        console.log('ID\tNAME\tROLE\tRUNTIME');
        for (const agent of agents)
          console.log(`${agent.id}\t${agent.name}\t${agent.role}\t${agent.runtime}`);
      }
    }
    return 0;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    repository?.close();
  }
}

process.exitCode = main(process.argv.slice(2));
