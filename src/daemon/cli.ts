import { SandboxJobs } from '../sandbox/jobs.js';
import { runSandboxCommand } from '../sandbox/cli.js';
import { SqliteScheduleRepository } from '../schedules/sqlite.js';
import { pollSchedules } from '../schedules/service.js';
import { pollExecutionTasks } from '../tasks/autonomy.js';
import { SqliteWakeupJournal } from '../activation/sqlite.js';
import { pollRoomWakeups, recoverWakeups } from '../activation/poll.js';
import { activateRoomMessage } from '../activation/service.js';
import {
  listA2AMessages,
  authorizeA2AMessage,
  delegateA2ATask,
  pollDelegationResults,
  pollDelegationReviews,
} from '../a2a/service.js';
import { acquireDatabaseLease } from './lease.js';
import type { DatabaseLease } from './lease.js';
import { runExecutionTask } from '../tasks/execution.js';
import { recoverInterruptedExecutionTasks } from '../tasks/service.js';
import { SqliteMemoryProvider } from '../memory/sqlite.js';
import { projectReviewedTaskMemories } from '../memory/reviews.js';
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
  readonly action: 'once' | 'deliveries' | 'wakeups' | 'run' | 'status' | 'dispatch' | 'stop';
  readonly db: string;
  readonly json: boolean;
  readonly socket: string;
  readonly socketClient: boolean;
  readonly interval: number;
  readonly runtimeConfig?: string;
  readonly wakeUp: boolean;
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
      'wake-up': { type: 'boolean' },
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
  if (
    parsed.values['wake-up'] &&
    (action !== undefined || parsed.values.once || parsed.values['runtime-config'] === undefined)
  )
    throw new Error('--wake-up requires continuous mode and --runtime-config');
  const base = {
    wakeUp: parsed.values['wake-up'] ?? false,
    db,
    json: parsed.values.json ?? false,
    socket,
    interval,
    socketClient: parsed.values.socket !== undefined,
    ...(parsed.values['runtime-config'] === undefined
      ? {}
      : { runtimeConfig: resolve(parsed.values['runtime-config']) }),
  };
  if (action === 'wakeups' && !parsed.values.once) return { ...base, action, socketClient: true };
  if (action === 'deliveries' && !parsed.values.once) return { ...base, action };
  if (action === undefined && parsed.values.once) return { ...base, action: 'once' };
  if (action === undefined && !parsed.values.once) return { ...base, action: 'run' };
  if ((action === 'status' || action === 'dispatch' || action === 'stop') && !parsed.values.once)
    return { ...base, action, socketClient: true };
  throw new Error('Expected daemon [--once], status|dispatch|deliveries|wakeups|stop');
}
function openOperations(
  db: string,
  drivers: ReturnType<typeof configuredDrivers>,
  wakeUp: boolean,
): DaemonOperations {
  const journal = new SqliteDeliveryJournal(db);
  let events: SqliteEventBus | undefined;
  let schedules: SqliteScheduleRepository | undefined;
  let agents: SqliteAgentRepository | undefined;
  let tasks: SqliteTaskProvider | undefined;
  let rooms: SqliteRoomRepository | undefined;
  let sessions: SqliteSessionStore | undefined;
  let memory: SqliteMemoryProvider | undefined;
  let wakeups: SqliteWakeupJournal | undefined;
  try {
    const eventBus = new SqliteEventBus(db);
    events = eventBus;
    const scheduleRepository = new SqliteScheduleRepository(db);
    schedules = scheduleRepository;
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
    const wakeupJournal = new SqliteWakeupJournal(db);
    wakeups = wakeupJournal;
    const sandboxJobs = new SandboxJobs();
    const shutdown = async () => {
      const results = await Promise.allSettled([runtime.shutdown(), sandboxJobs.shutdown()]);
      const errors: unknown[] = [];
      for (const result of results)
        if (result.status === 'rejected') {
          const reason: unknown = result.reason;
          errors.push(reason);
        }
      if (errors.length) throw new AggregateError(errors, 'Daemon runtime shutdown failed');
    };
    runtime.recover();
    recoverWakeups(wakeupJournal, () => new Date().toISOString());
    recoverInterruptedExecutionTasks(taskProvider, () => new Date().toISOString());
    const activate = (roomId: string, messageId: string) => {
      const source = roomRepository.messages(roomId).find((m) => m.id === messageId);
      if (source && 'a2a' in source.metadata) {
        const envelope = listA2AMessages(roomRepository, roomId, taskProvider).find(
          (message) => message.id === messageId,
        );
        authorizeA2AMessage(agentRepository, source);
        if (envelope?.type === 'delegate') {
          delegateA2ATask(roomRepository, agentRepository, taskProvider, roomId, messageId);
          return Promise.resolve([]);
        }
      }
      return activateRoomMessage(
        roomRepository,
        sessionStore,
        (agentId, roomId) => runtime.open(agentId, roomId),
        (sessionId, messageId) =>
          replyToRoomMessage(
            roomRepository,
            sessionStore,
            runtime,
            { sessionId, messageId, instruction: '' },
            { id: randomUUID(), at: new Date().toISOString() },
            memoryProvider,
          ),
        roomId,
        messageId,
      );
    };
    const execute = (taskId: string, sessionId: string, messageId: string) =>
      runExecutionTask(
        taskProvider,
        sessionStore,
        roomRepository,
        (id, source, instruction) =>
          replyToRoomMessage(
            roomRepository,
            sessionStore,
            runtime,
            { sessionId: id, messageId: source, instruction },
            { id: randomUUID(), at: new Date().toISOString() },
            memoryProvider,
          ),
        { taskId, sessionId, messageId },
        () => new Date().toISOString(),
      );
    return {
      dispatch: () => {
        pollSchedules(scheduleRepository, eventBus, () => Date.now());
        return dispatchEvents(eventBus, agentRepository, taskProvider, journal);
      },
      deliveries: () => journal.list(),
      wakeups: () => wakeupJournal.list(),
      ...(wakeUp
        ? {
            wakeUp: async (signal?: AbortSignal) => {
              await pollRoomWakeups(
                roomRepository,
                sessionStore,
                wakeupJournal,
                activate,
                () => new Date().toISOString(),
                signal,
              );
              await pollExecutionTasks(
                taskProvider,
                roomRepository,
                sessionStore,
                (agentId, roomId) => runtime.open(agentId, roomId),
                execute,
                () => ({ id: randomUUID(), createdAt: new Date().toISOString() }),
                signal,
              );
              await pollDelegationResults(
                roomRepository,
                agentRepository,
                taskProvider,
                () => ({ id: randomUUID(), createdAt: new Date().toISOString() }),
                signal,
              );
              await pollDelegationReviews(roomRepository, agentRepository, taskProvider, signal);
              projectReviewedTaskMemories(memoryProvider, agentRepository, taskProvider, signal);
            },
          }
        : {}),
      command: (argv) =>
        executeApplication(argv, db, true, {
          store: sessionStore,
          runtime,
          activateRoom: activate,
          runTask: execute,
          cancelSandbox: (taskId) => sandboxJobs.cancel(taskId),
          runSandbox: async (command) => {
            const output: string[] = [];
            if (command.action === 'run')
              await sandboxJobs.run(command.taskId, (signal) =>
                runSandboxCommand(command, (line) => output.push(line), signal),
              );
            else await runSandboxCommand(command, (line) => output.push(line));
            if (output.length !== 1) throw new Error('Sandbox command output missing');
            return output[0] ?? '';
          },
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
      shutdown,
      close: async () => {
        try {
          await shutdown();
        } finally {
          releaseResources([
            scheduleRepository,
            wakeupJournal,
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
        [schedules, wakeups, memory, sessions, rooms, tasks, agents, events, journal].flatMap(
          (resource) => (resource ? [resource] : []),
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
    const drivers = configuredDrivers(command.runtimeConfig);
    let lease: DatabaseLease | undefined;
    try {
      await runLocalDaemon(command.socket, command.interval, () => {
        lease = acquireDatabaseLease(command.db);
        return openOperations(lease.databasePath, drivers, command.wakeUp);
      });
    } finally {
      lease?.close();
    }

    return;
  }
  if (
    command.action === 'status' ||
    command.action === 'wakeups' ||
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
  let schedules: SqliteScheduleRepository | undefined;
  let agents: SqliteAgentRepository | undefined;
  let tasks: SqliteTaskProvider | undefined;
  try {
    let result: unknown;
    if (command.action === 'deliveries') result = journal.list();
    else {
      events = new SqliteEventBus(command.db);
      schedules = new SqliteScheduleRepository(command.db);
      pollSchedules(schedules, events, () => Date.now());
      agents = new SqliteAgentRepository(command.db);
      tasks = new SqliteTaskProvider(command.db);
      result = dispatchEvents(events, agents, tasks, journal);
    }
    console.log(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    releaseResources(
      [schedules, tasks, agents, events, journal].flatMap((resource) =>
        resource ? [resource] : [],
      ),
    );
  }
}
