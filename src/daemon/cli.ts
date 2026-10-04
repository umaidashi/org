import { SqliteMemoryProvider } from '../memory/sqlite.js';
import { replyToRoomMessage } from '../rooms/runtime.js';
import { randomUUID } from 'node:crypto';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { SqliteSessionStore } from '../sessions/sqlite.js';
import { LocalAgentRuntime } from '../runtime/manager.js';
import { configuredDrivers } from '../runtime/config.js';
import { socketForDatabase } from '../application/transport.js';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { SqliteEventBus } from '../events/sqlite.js';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
import { dispatchEvents, releaseResources } from './service.js';
import { SqliteDeliveryJournal } from './sqlite.js';
import { requestDaemon } from './client.js';
import { runLocalDaemon } from './server.js';
import type { DaemonOperations } from './server.js';
import { executeApplication } from '../application/cli.js';
export interface DaemonCommand {
  readonly action: 'once' | 'deliveries' | 'run' | 'status' | 'dispatch' | 'stop';
  readonly db: string;
  readonly json: boolean;
  readonly socket: string;
  readonly socketClient: boolean;
  readonly interval: number;
  readonly runtimeConfig?: string;
}
export function parseDaemonCommand(argv: string[]): DaemonCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      once: { type: 'boolean' },
      socket: { type: 'string' },
      'poll-interval': { type: 'string' },
      'runtime-config': { type: 'string' },
    },
  });
  const [noun, action, ...extra] = parsed.positionals;
  if (noun !== 'daemon' || extra.length) throw new Error('Expected daemon command');
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim()) throw new Error('Database path must not be empty');
  const rawSocket = parsed.values.socket ?? socketForDatabase(db);
  if (!rawSocket.trim()) throw new Error('Socket path must not be empty');
  const socket = resolve(rawSocket);
  if (parsed.values.once && parsed.values.socket !== undefined)
    throw new Error('--socket cannot be used with --once');
  const usesSocket =
    !parsed.values.once && (action !== 'deliveries' || parsed.values.socket !== undefined);
  if (usesSocket && Buffer.byteLength(socket) > 100)
    throw new Error('Socket path must be at most 100 bytes');
  const interval = Number(parsed.values['poll-interval'] ?? '1000');
  if (!Number.isInteger(interval) || interval < 10 || interval > 60_000)
    throw new Error('Poll interval must be an integer from 10 to 60000 milliseconds');
  if (parsed.values['poll-interval'] !== undefined && (action !== undefined || parsed.values.once))
    throw new Error('--poll-interval is only available in continuous mode');
  if (parsed.values['runtime-config'] !== undefined && (action !== undefined || parsed.values.once))
    throw new Error('--runtime-config is only available in continuous mode');
  if (parsed.values['runtime-config'] !== undefined && !parsed.values['runtime-config'].trim())
    throw new Error('Runtime config path required');
  const base = {
    db,
    json: parsed.values.json ?? false,
    socket,
    interval,
    socketClient: parsed.values.socket !== undefined,
    ...(parsed.values['runtime-config'] === undefined
      ? {}
      : { runtimeConfig: resolve(parsed.values['runtime-config']) }),
  };
  if (action === 'deliveries' && !parsed.values.once) return { ...base, action };
  if (action === undefined && parsed.values.once) return { ...base, action: 'once' };
  if (action === undefined && !parsed.values.once) return { ...base, action: 'run' };
  if ((action === 'status' || action === 'dispatch' || action === 'stop') && !parsed.values.once)
    return { ...base, action, socketClient: true };
  throw new Error('Expected daemon [--once], status|dispatch|deliveries|stop');
}
function openOperations(db: string, runtimeConfig?: string): DaemonOperations {
  const drivers = configuredDrivers(runtimeConfig);
  const journal = new SqliteDeliveryJournal(db);
  let events: SqliteEventBus | undefined;
  let agents: SqliteAgentRepository | undefined;
  let tasks: SqliteTaskProvider | undefined;
  let rooms: SqliteRoomRepository | undefined;
  let sessions: SqliteSessionStore | undefined;
  let memory: SqliteMemoryProvider | undefined;
  try {
    const eventBus = new SqliteEventBus(db);
    events = eventBus;
    const agentRepository = new SqliteAgentRepository(db);
    agents = agentRepository;
    const taskProvider = new SqliteTaskProvider(db);
    tasks = taskProvider;
    const roomRepository = new SqliteRoomRepository(db);
    rooms = roomRepository;
    const sessionStore = new SqliteSessionStore(db);
    sessions = sessionStore;
    const runtime = new LocalAgentRuntime(
      sessionStore,
      agentRepository,
      roomRepository,
      drivers,
      () => new Date().toISOString(),
      randomUUID,
    );
    const memoryProvider = new SqliteMemoryProvider(db);
    memory = memoryProvider;
    runtime.recover();
    return {
      dispatch: () => dispatchEvents(eventBus, agentRepository, taskProvider, journal),
      deliveries: () => journal.list(),
      command: (argv) =>
        executeApplication(argv, db, true, {
          store: sessionStore,
          runtime,
          reply: (id, messageId, instruction) =>
            replyToRoomMessage(
              roomRepository,
              sessionStore,
              runtime,
              { sessionId: id, messageId, instruction },
              { id: randomUUID(), at: new Date().toISOString() },
              memoryProvider,
            ),
        }),
      shutdown: () => runtime.shutdown(),
      close: async () => {
        try {
          await runtime.shutdown();
        } finally {
          releaseResources([
            memoryProvider,
            sessionStore,
            roomRepository,
            taskProvider,
            agentRepository,
            eventBus,
            journal,
          ]);
        }
      },
    };
  } catch (error) {
    try {
      releaseResources(
        [memory, sessions, rooms, tasks, agents, events, journal].flatMap((resource) =>
          resource ? [resource] : [],
        ),
      );
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Daemon initialization failed');
    }
    throw error;
  }
}
export async function runDaemonCommand(command: DaemonCommand): Promise<void> {
  if (command.action === 'run') {
    await runLocalDaemon(command.socket, command.interval, () =>
      openOperations(command.db, command.runtimeConfig),
    );
    return;
  }
  if (
    command.action === 'status' ||
    command.action === 'dispatch' ||
    command.action === 'stop' ||
    (command.action === 'deliveries' && command.socketClient)
  ) {
    const value = await requestDaemon(command.socket, command.action);
    console.log(JSON.stringify(value, null, command.json ? undefined : 2));
    return;
  }
  const journal = new SqliteDeliveryJournal(command.db);
  let events: SqliteEventBus | undefined;
  let agents: SqliteAgentRepository | undefined;
  let tasks: SqliteTaskProvider | undefined;
  try {
    let result: unknown;
    if (command.action === 'deliveries') result = journal.list();
    else {
      events = new SqliteEventBus(command.db);
      agents = new SqliteAgentRepository(command.db);
      tasks = new SqliteTaskProvider(command.db);
      result = dispatchEvents(events, agents, tasks, journal);
    }
    console.log(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    releaseResources(
      [tasks, agents, events, journal].flatMap((resource) => (resource ? [resource] : [])),
    );
  }
}
