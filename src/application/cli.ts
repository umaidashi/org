import { parseKnowledgeCommand, runKnowledgeCommand } from '../knowledge/cli.js';
import {
  parseWorkflowCommand,
  runWorkflowCommand,
  type WorkflowCommand,
} from '../workflows/cli.js';
import {
  parseApprovalCommand,
  runApprovalCommand,
  type ApprovalCommand,
} from '../approvals/cli.js';
import { parseSandboxCommand, runSandboxCommand, type SandboxCommand } from '../sandbox/cli.js';
import {
  parseScheduleCommand,
  runScheduleCommand,
  type ScheduleCommand,
} from '../schedules/cli.js';
import { parseA2ACommand, runA2ACommand } from '../a2a/cli.js';
import type { A2ACommand } from '../a2a/cli.js';
import { parseMemoryCommand, runMemoryCommand } from '../memory/cli.js';
import type { MemoryCommand } from '../memory/cli.js';
import { parseSessionCommand, runSessionCommand } from '../sessions/cli.js';
import type { SessionCommand, SessionContext } from '../sessions/cli.js';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateCapabilities, validateMemoryPolicy, type AgentInput } from '../agents/domain.js';
import { registerAgent, setReportingLine } from '../agents/service.js';
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
       org agent report ID --to MANAGER_ID|--clear [--json]
       org approval request|get|list|decide|apply [OPTIONS]
       org audit list [--json]
       org tui [--socket PATH] [--room ID --human ID]
       org logs [--task ID] [--event ID] [--limit N] [--json]
       org agent capabilities|capability-history ID [--json]
       org agent reporting-history ID [--json]
       org [--db PATH] task create TITLE --objective OBJECTIVE [--json]
       org [--db PATH] task list|get|assign|update|history|review|reviews [OPTIONS]
       org [--db PATH] room create|list|get|archive|send|messages|targets|activate [OPTIONS]
       org [--db PATH] event publish|import-github|get|list|subscribe|subscriptions|matches|enable|disable [OPTIONS]
       org sandbox run TASK --code TS [--writable] [--timeout-ms MS]
       org sandbox artifact URI
       org sandbox cancel TASK_ID
       org workflow run|status|cancel|list|history [OPTIONS]
       org schedule create|list|get|enable|disable [OPTIONS]
       org knowledge notion PAGE_ID [--room ROOM --human HUMAN] [--json]
       org a2a send|adopt|get|list [OPTIONS]
       org memory capture|extract|consolidate|consolidations|get|list|search|invalidate [OPTIONS]
       org session start|send|resume|reply|stop|get|list|history [OPTIONS]
       org task observe-workflow ID --expected-version N
       org task resume-workflow ID --approval ID --expected-version N
       org task linear-get|import-linear ISSUE_ID [--json]
       org task refresh-linear LOCAL_TASK_ID --expected-version N [--json]
       org task artifact-content ID --artifact ARTIFACT_ID [--json]
       org [--db PATH] daemon --once [--json]
       org [--db PATH] daemon deliveries [--json]
       org [--db PATH] daemon [--socket PATH] [--poll-interval MS] [--workflow-config PATH] [--observe-workflows]
       org daemon status|dispatch|wakeups|stop --socket PATH [--json]

Register and list persistent Agent identities. Runtime processes are not started.
Default DB: ~/.local/share/org/org.db`;

class UsageError extends Error {}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new UsageError(`Missing ${name}`);
  return value;
}

export type ApplicationCommand =
  | { readonly kind: 'knowledge'; readonly command: ReturnType<typeof parseKnowledgeCommand> }
  | { readonly kind: 'workflow'; readonly command: WorkflowCommand }
  | { readonly kind: 'approval'; readonly command: ApprovalCommand }
  | {
      readonly kind: 'capabilities' | 'capability-history';
      readonly db: string;
      readonly json: boolean;
      readonly id: string;
    }
  | { readonly kind: 'sandbox'; readonly command: SandboxCommand }
  | { readonly kind: 'schedule'; readonly command: ScheduleCommand }
  | { readonly kind: 'a2a'; readonly command: A2ACommand }
  | { readonly kind: 'memory'; readonly command: MemoryCommand }
  | { kind: 'session'; command: SessionCommand }
  | { kind: 'help' }
  | { kind: 'task'; command: TaskCommand }
  | { kind: 'room'; command: RoomCommand }
  | { kind: 'event'; command: EventCommand }
  | { kind: 'create'; db: string; input: AgentInput }
  | { kind: 'list'; db: string; json: boolean }
  | { kind: 'report'; db: string; json: boolean; id: string; manager: string | null }
  | { kind: 'reporting-history'; db: string; json: boolean; id: string };

export function parseApplicationCommand(argv: string[]): ApplicationCommand {
  const probe = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { db: { type: 'string' } },
  });
  if (['approval', 'audit', 'logs'].includes(probe.positionals[0] ?? ''))
    return { kind: 'approval', command: parseApprovalCommand(argv) };
  if (probe.positionals[0] === 'knowledge')
    return { kind: 'knowledge', command: parseKnowledgeCommand(argv) };
  if (probe.positionals[0] === 'workflow')
    return { kind: 'workflow', command: parseWorkflowCommand(argv) };
  if (probe.positionals[0] === 'sandbox')
    return { kind: 'sandbox', command: parseSandboxCommand(argv) };
  if (probe.positionals[0] === 'schedule')
    return { kind: 'schedule', command: parseScheduleCommand(argv) };
  if (probe.positionals[0] === 'a2a') return { kind: 'a2a', command: parseA2ACommand(argv) };
  if (probe.positionals[0] === 'memory')
    return { kind: 'memory', command: parseMemoryCommand(argv) };
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
      'reports-to': { type: 'string' },
      capability: { type: 'string', multiple: true },
      'memory-policy': { type: 'string' },
      to: { type: 'string' },
      clear: { type: 'boolean' },
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
  const allowed: Record<string, readonly string[]> = {
    create: ['role', 'runtime', 'reports-to', 'capability', 'memory-policy'],
    list: [],
    capabilities: [],
    'capability-history': [],
    report: ['to', 'clear'],
    'reporting-history': [],
  };
  const actionOptions = action === undefined ? undefined : allowed[action];
  if (!actionOptions) throw new UsageError('Expected agent create/list/report/reporting-history');
  for (const option of Object.keys(parsed.values))
    if (!['db', 'json', 'help', ...actionOptions].includes(option))
      throw new UsageError(`Unexpected --${option} for agent ${action}`);
  if (action === 'capabilities' || action === 'capability-history')
    return { kind: action, db, json: parsed.values.json ?? false, id: required(name, 'agent id') };
  if (action === 'reporting-history')
    return {
      kind: 'reporting-history',
      db,
      json: parsed.values.json ?? false,
      id: required(name, 'agent id'),
    };
  if (action === 'report') {
    if ((parsed.values.to !== undefined) === Boolean(parsed.values.clear))
      throw new UsageError('Choose --to or --clear');
    const manager = parsed.values.clear ? null : required(parsed.values.to, 'manager id');
    if (manager !== null && !manager.trim()) throw new UsageError('Manager id must not be empty');
    return {
      kind: 'report',
      db,
      json: parsed.values.json ?? false,
      id: required(name, 'agent id'),
      manager,
    };
  }
  if (action === 'create') {
    if (parsed.values.json) throw new UsageError('--json is only available for list');
    return {
      kind: 'create',
      db,
      input: {
        name: required(name, 'name'),
        ...(parsed.values['memory-policy'] === undefined
          ? {}
          : { memoryPolicy: validateMemoryPolicy(parsed.values['memory-policy']) }),
        ...(parsed.values.capability !== undefined
          ? { capabilities: validateCapabilities(parsed.values.capability) }
          : {}),
        role: required(parsed.values.role, '--role'),
        runtime: required(parsed.values.runtime, '--runtime'),
        ...(parsed.values['reports-to'] !== undefined
          ? { reportsTo: parsed.values['reports-to'] }
          : {}),
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

export interface ApplicationContext extends SessionContext {
  readonly runSandbox?: (command: SandboxCommand) => Promise<string>;
  readonly cancelSandbox?: (taskId: string) => void;
  readonly activateRoom?: (roomId: string, messageId: string) => Promise<unknown>;
  readonly observeTaskWorkflow?: (id: string, expectedVersion: number) => Promise<unknown>;
  readonly resumeTaskWorkflow?: (
    id: string,
    approvalId: string,
    expectedVersion: number,
  ) => Promise<unknown>;
  readonly runTask?: (id: string, sessionId: string, messageId: string) => Promise<unknown>;
}

async function runApplication(
  command: ApplicationCommand,
  db: string,
  output: (line: string) => void,
  sessions?: ApplicationContext,
): Promise<void> {
  if (command.kind === 'workflow') {
    await runWorkflowCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'approval') {
    runApprovalCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'sandbox') {
    if (command.command.action === 'cancel') {
      if (!sessions?.cancelSandbox) throw new Error('Sandbox cancel requires daemon');
      sessions.cancelSandbox(command.command.taskId);
      output(JSON.stringify({ taskId: command.command.taskId, state: 'cancelling' }));
    } else if (sessions?.runSandbox) output(await sessions.runSandbox({ ...command.command, db }));
    else await runSandboxCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'schedule') {
    runScheduleCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'knowledge') {
    await runKnowledgeCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'a2a') {
    runA2ACommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'memory') {
    runMemoryCommand({ ...command.command, db }, output);
    return;
  }
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
    if (command.command.action.kind === 'observe-workflow') {
      if (!sessions?.observeTaskWorkflow) throw new Error('Workflow observation requires daemon');
      const { id, expectedVersion } = command.command.action;
      output(
        JSON.stringify(
          await sessions.observeTaskWorkflow(id, expectedVersion),
          null,
          command.command.json ? undefined : 2,
        ),
      );
      return;
    }
    if (command.command.action.kind === 'resume-workflow') {
      if (!sessions?.resumeTaskWorkflow) throw new Error('Workflow resume requires daemon');
      const { id, approvalId, expectedVersion } = command.command.action;
      output(
        JSON.stringify(
          await sessions.resumeTaskWorkflow(id, approvalId, expectedVersion),
          null,
          command.command.json ? undefined : 2,
        ),
      );
      return;
    }
    if (command.command.action.kind === 'run') {
      if (!sessions?.runTask) throw new Error('Task run requires daemon');
      const { id, sessionId, messageId } = command.command.action;
      output(
        JSON.stringify(
          await sessions.runTask(id, sessionId, messageId),
          null,
          command.command.json ? undefined : 2,
        ),
      );
      return;
    }
    await runTaskCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'room') {
    if (command.command.action === 'activate') {
      if (!sessions?.activateRoom) throw new Error('Room activation requires daemon');
      output(
        JSON.stringify(
          await sessions.activateRoom(command.command.id, command.command.messageId),
          null,
          command.command.json ? undefined : 2,
        ),
      );
      return;
    }
    runRoomCommand({ ...command.command, db }, output);
    return;
  }
  if (command.kind === 'event') {
    await runEventCommand({ ...command.command, db }, output);
    return;
  }
  let repository: SqliteAgentRepository | undefined;
  try {
    repository = new SqliteAgentRepository(db);
    if (command.kind === 'capabilities' || command.kind === 'capability-history') {
      output(
        JSON.stringify(
          command.kind === 'capabilities'
            ? repository.capabilitySnapshot(command.id)
            : repository.capabilityHistory(command.id),
          null,
          command.json ? undefined : 2,
        ),
      );
    } else if (command.kind === 'report') {
      output(
        JSON.stringify(
          setReportingLine(repository, command.id, command.manager, new Date().toISOString()),
          null,
          command.json ? undefined : 2,
        ),
      );
    } else if (command.kind === 'reporting-history') {
      output(
        JSON.stringify(repository.reportingHistory(command.id), null, command.json ? undefined : 2),
      );
    } else if (command.kind === 'create') {
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
  sessions?: ApplicationContext,
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
