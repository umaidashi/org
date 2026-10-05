import { validateRoomAllowlist } from '../rooms/domain.js';
import { extractRoomReplyMemories } from '../memory/extraction.js';
import { jsonMemoryExtractor } from '../memory/extractor.js';
import { adoptCoordinatorReply } from '../a2a/proposal.js';
import { observeTaskWorkflow, pollTaskWorkflowObservations } from '../workflows/task-observe.js';
import { SqliteApprovalStore } from '../approvals/sqlite.js';
import { requestTaskWorkflowApproval } from '../workflows/task-approval.js';
import { resumeTaskWorkflow } from '../workflows/task-resume.js';
import { produceTaskWorkflowArtifact } from '../workflows/task.js';
import { configuredWorkflowRuntime } from '../workflows/cli.js';
import { pollWorkflowDeliveries } from '../workflows/delivery.js';
import { validateSandboxPolicy, type SandboxPolicy } from '../sandbox/domain.js';
import { produceTaskSandboxArtifact } from '../sandbox/service.js';
import { runDockerSandbox } from '../sandbox/docker.js';
import { saveSandboxArtifact } from '../sandbox/artifact.js';
import { runProcess } from '../runtime/process.js';
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
import { consolidateRoomMemories } from '../memory/consolidation.js';
import { pollMemoryConsolidations, validateNightlyRooms } from '../memory/nightly.js';
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
  readonly sandboxConfig?: string;
  readonly workflowConfig?: string;
  readonly wakeUp: boolean;
  readonly consolidationRooms?: readonly string[];
  readonly delegationRooms?: readonly string[];
  readonly extractionRooms?: readonly string[];
  readonly observeWorkflows?: boolean;
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
      'sandbox-config': { type: 'string' },
      'workflow-config': { type: 'string' },
      'wake-up': { type: 'boolean' },
      'observe-workflows': { type: 'boolean' },
      'delegation-room': { type: 'string', multiple: true },
      'memory-extraction-room': { type: 'string', multiple: true },
      'memory-consolidation-room': { type: 'string', multiple: true },
    },
  });
  const [noun, action, ...extra] = parsed.positionals;
  if (
    parsed.values['observe-workflows'] &&
    (action !== undefined || parsed.values.once || parsed.values['workflow-config'] === undefined)
  )
    throw new Error('--observe-workflows requires configured continuous mode');
  const delegationRooms = parsed.values['delegation-room'];
  const extractionRooms = parsed.values['memory-extraction-room'];
  for (const [flag, ids] of [
    ['--delegation-room', delegationRooms],
    ['--memory-extraction-room', extractionRooms],
  ] as const) {
    if (ids === undefined) continue;
    validateRoomAllowlist(ids);
    if (
      action !== undefined ||
      parsed.values.once ||
      !parsed.values['wake-up'] ||
      parsed.values['runtime-config'] === undefined
    )
      throw new Error(`${flag} requires configured continuous wake-up`);
  }
  const consolidationRooms = parsed.values['memory-consolidation-room'];
  if (consolidationRooms !== undefined) {
    validateNightlyRooms(consolidationRooms);
    if (action !== undefined || parsed.values.once)
      throw new Error('--memory-consolidation-room requires continuous mode');
  }
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
  if (
    parsed.values['workflow-config'] !== undefined &&
    (action !== undefined || parsed.values.once || !parsed.values['workflow-config'].trim())
  )
    throw new Error('--workflow-config requires a path and continuous mode');
  if (
    parsed.values['sandbox-config'] !== undefined &&
    (action !== undefined ||
      parsed.values.once ||
      parsed.values['runtime-config'] === undefined ||
      !parsed.values['sandbox-config'].trim())
  )
    throw new Error('--sandbox-config requires continuous mode and --runtime-config');
  const base = {
    ...(delegationRooms === undefined ? {} : { delegationRooms }),
    ...(extractionRooms === undefined ? {} : { extractionRooms }),
    ...(consolidationRooms === undefined ? {} : { consolidationRooms }),
    ...(parsed.values['sandbox-config'] === undefined
      ? {}
      : { sandboxConfig: resolve(parsed.values['sandbox-config']) }),
    ...(parsed.values['workflow-config'] === undefined
      ? {}
      : { workflowConfig: resolve(parsed.values['workflow-config']) }),
    wakeUp: parsed.values['wake-up'] ?? false,
    observeWorkflows: parsed.values['observe-workflows'] ?? false,
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
  sandboxPolicy?: SandboxPolicy,
  workflow?: Awaited<ReturnType<typeof configuredWorkflowRuntime>>,
  consolidationRooms: readonly string[] = [],
  delegationRooms: readonly string[] = [],
  extractionRooms: readonly string[] = [],
  observeWorkflows = false,
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
  let approvals: SqliteApprovalStore | undefined;
  try {
    const approvalStore = new SqliteApprovalStore(db);
    approvals = approvalStore;
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
    for (const roomId of consolidationRooms) {
      if (roomRepository.get(roomId).id !== roomId)
        throw new Error('Memory consolidation Room unavailable');
    }
    for (const id of extractionRooms) {
      const room = roomRepository.get(id);
      if (room.id !== id || room.archivedAt !== null)
        throw new Error('Automatic Memory requires active Room');
    }
    for (const id of delegationRooms) {
      const room = roomRepository.get(id);
      if (
        room.id !== id ||
        room.archivedAt !== null ||
        room.activationPolicy !== 'coordinator' ||
        room.coordinatorId === undefined
      )
        throw new Error('Automatic delegation requires active Coordinator Room');
    }
    const wakeupJournal = new SqliteWakeupJournal(db);
    wakeups = wakeupJournal;
    const sandboxJobs = new SandboxJobs();
    const workflowController = new AbortController();
    const shutdown = async () => {
      workflowController.abort();
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
    const activate = async (roomId: string, messageId: string) => {
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
      const replies = await activateRoomMessage(
        roomRepository,
        sessionStore,
        (agentId, roomId) => runtime.open(agentId, roomId),
        (sessionId, messageId) => {
          const room = roomRepository.get(roomId);
          const instruction = {
            ...(delegationRooms.includes(roomId) &&
            source?.sender.kind === 'human' &&
            sessionStore.get(sessionId).agentId === room.coordinatorId
              ? {
                  delegation: {
                    policy:
                      'If specialist delegation is needed, reply only one JSON object with version=1, tool=a2a, type=delegate, to=one allowed target ID, payload={objective:string}. Otherwise reply ordinary text or another allowed tool proposal. No other fields.',
                    targets: agentRepository
                      .list()
                      .filter(
                        (a) =>
                          a.reportsTo === room.coordinatorId &&
                          room.participants.some((p) => p.kind === 'agent' && p.id === a.id),
                      )
                      .map((a) => ({ id: a.id, name: a.name, role: a.role })),
                  },
                }
              : {}),
            ...(extractionRooms.includes(roomId) && source?.sender.kind === 'human'
              ? {
                  memory: {
                    policy:
                      'For durable Room Memory requests, reply only JSON {version:1,tool:memory,candidates:[{type:semantic|episodic|procedural|relational,content:string,confidence:number,sourceMessageIds:[prior same-Room message ID],supersedes?:existing Memory ID}]}. Otherwise reply ordinary text or another allowed tool proposal. Memory writes require read/write capabilities and remain in this Room.',
                  },
                }
              : {}),
          };
          return replyToRoomMessage(
            roomRepository,
            sessionStore,
            runtime,
            {
              sessionId,
              messageId,
              instruction: Object.keys(instruction).length ? JSON.stringify(instruction) : '',
            },
            { id: randomUUID(), at: new Date().toISOString() },
            memoryProvider,
          );
        },
        roomId,
        messageId,
      );
      if (delegationRooms.includes(roomId))
        adoptCoordinatorReply(
          roomRepository,
          agentRepository,
          taskProvider,
          roomId,
          messageId,
          replies.map((m) => m.id),
        );
      if (extractionRooms.includes(roomId))
        extractRoomReplyMemories(
          roomRepository,
          agentRepository,
          memoryProvider,
          jsonMemoryExtractor,
          roomId,
          messageId,
          replies.map((m) => m.id),
        );
      return replies;
    };
    const execute = (taskId: string, sessionId: string, messageId: string) => {
      const shellTask =
        sandboxPolicy !== undefined &&
        agentRepository
          .list()
          .some(
            (a) =>
              a.id === taskProvider.get(taskId).owner && a.capabilities?.includes('can_run_shell'),
          );
      const workflowScope = workflow?.agentScopes.find(
        (scope) => scope.agentId === taskProvider.get(taskId).owner && scope.workflowIds.length > 0,
      );
      if (shellTask && workflowScope)
        throw new Error('Task has ambiguous Sandbox and Workflow scopes');
      return runExecutionTask(
        taskProvider,
        sessionStore,
        roomRepository,
        (id, source, instruction) =>
          replyToRoomMessage(
            roomRepository,
            sessionStore,
            runtime,
            {
              sessionId: id,
              messageId: source,
              instruction,
            },
            { id: randomUUID(), at: new Date().toISOString() },
            memoryProvider,
          ),
        {
          taskId,
          sessionId,
          messageId,
          ...(workflowScope
            ? {
                instruction:
                  'Return only JSON: {"version":1,"tool":"workflow","workflowId":"allowed ID","input":{}}. Use one short ' +
                  (workflowScope.effect === 'read_only'
                    ? 'read-only Workflow'
                    : 'Workflow requiring human Approval') +
                  ' from this host allowlist: ' +
                  JSON.stringify(workflowScope.workflowIds) +
                  '. Credentials remain on the host. The native result is saved for human review.',
              }
            : shellTask && sandboxPolicy
              ? {
                  instruction:
                    'Return only JSON: {"version":1,"tool":"sandbox","code":"TypeScript code"}. Code runs in isolated Bun with no network. Produce the Task result for human review. Host policy: ' +
                    JSON.stringify({
                      writable: sandboxPolicy.writable,
                      files: sandboxPolicy.files,
                      timeoutMs: sandboxPolicy.timeoutMs,
                      maxOutputBytes: sandboxPolicy.maxOutputBytes,
                      repoProvided: sandboxPolicy.repo !== undefined,
                    }),
                }
              : {}),
        },
        () => new Date().toISOString(),
        workflowScope && workflow !== undefined
          ? async (running, message) =>
              produceTaskWorkflowArtifact(
                taskProvider,
                agentRepository,
                roomRepository,
                eventBus,
                running,
                message,
                {
                  ...workflow,
                  requestApproval: (running, message, effect) => {
                    requestTaskWorkflowApproval(
                      taskProvider,
                      agentRepository,
                      roomRepository,
                      approvalStore,
                      {
                        taskId: running.id,
                        roomId: message.roomId,
                        messageId: message.id,
                        expectedVersion: running.version,
                        host: workflow.host,
                        effect,
                        phase: 'running',
                      },
                      { id: randomUUID(), createdAt: new Date().toISOString() },
                    );
                  },
                },
                (bytes) => saveSandboxArtifact(db + '.artifacts', bytes),
                () => new Date().toISOString(),
                () => randomUUID(),
                workflowController.signal,
              )
          : shellTask && sandboxPolicy !== undefined
            ? async (running, message) => {
                let artifact: Awaited<ReturnType<typeof produceTaskSandboxArtifact>> | undefined;
                await sandboxJobs.run(running.id, async (signal) => {
                  artifact = await produceTaskSandboxArtifact(
                    taskProvider,
                    agentRepository,
                    roomRepository,
                    running,
                    message,
                    sandboxPolicy,
                    (input) =>
                      runDockerSandbox(
                        runProcess,
                        {
                          executable: 'docker',
                          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
                          cwd: process.cwd(),
                          uid: process.getuid?.() ?? 0,
                          gid: process.getgid?.() ?? 0,
                        },
                        input,
                        signal,
                      ),
                    (bytes) => saveSandboxArtifact(db + '.artifacts', bytes),
                    () => new Date().toISOString(),
                    randomUUID,
                  );
                });
                if (!artifact) throw new Error('Sandbox artifact missing');
                return artifact;
              }
            : undefined,
      );
    };
    const observe = (
      taskId: string,
      expectedVersion: number,
      signal = workflowController.signal,
      readyOnly = false,
    ) => {
      if (!workflow) throw new Error('Workflow host config missing');
      return observeTaskWorkflow(
        taskProvider,
        agentRepository,
        roomRepository,
        approvalStore,
        eventBus,
        workflow,
        { taskId, expectedVersion, readyOnly },
        (bytes) => saveSandboxArtifact(db + '.artifacts', bytes),
        () => new Date().toISOString(),
        randomUUID,
        signal,
      );
    };
    return {
      dispatch: () => {
        pollSchedules(scheduleRepository, eventBus, () => Date.now());
        pollMemoryConsolidations(
          roomRepository,
          memoryProvider,
          {
            consolidate: (request) =>
              consolidateRoomMemories(roomRepository, memoryProvider, memoryProvider, request),
          },
          consolidationRooms,
          () => Date.now(),
        );
        return dispatchEvents(
          eventBus,
          agentRepository,
          taskProvider,
          journal,
          workflow !== undefined,
        );
      },
      deliveries: () => journal.list(),
      wakeups: () => wakeupJournal.list(),
      ...(wakeUp || workflow !== undefined
        ? {
            wakeUp: async (signal?: AbortSignal) => {
              if (observeWorkflows)
                await pollTaskWorkflowObservations(
                  taskProvider,
                  eventBus,
                  (taskId, version) => observe(taskId, version, signal, true),
                  signal,
                );
              if (workflow)
                await pollWorkflowDeliveries(
                  eventBus,
                  journal,
                  {
                    ...workflow,
                    workflows: new Set(
                      workflow.workflows.filter((w) => w.effect === 'read_only').map((w) => w.id),
                    ),
                  },
                  () => new Date().toISOString(),
                  signal,
                );
              if (!wakeUp) return;
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
          observeTaskWorkflow: (taskId, expectedVersion) => {
            return observe(taskId, expectedVersion);
          },
          resumeTaskWorkflow: (taskId, approvalId, expectedVersion) => {
            if (!workflow) throw new Error('Workflow host config missing');
            return resumeTaskWorkflow(
              taskProvider,
              agentRepository,
              roomRepository,
              approvalStore,
              eventBus,
              workflow,
              { taskId, approvalId, expectedVersion },
              (bytes) => saveSandboxArtifact(db + '.artifacts', bytes),
              () => new Date().toISOString(),
              randomUUID,
              workflowController.signal,
            );
          },
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
            approvalStore,
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
        [
          approvals,
          schedules,
          wakeups,
          memory,
          sessions,
          rooms,
          tasks,
          agents,
          events,
          journal,
        ].flatMap((resource) => (resource ? [resource] : [])),
      );
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Daemon initialization failed');
    }
    throw error;
  }
}
export async function runDaemonCommand(command: DaemonCommand): Promise<void> {
  if (command.action === 'run') {
    const workflow =
      command.workflowConfig === undefined
        ? undefined
        : await configuredWorkflowRuntime(command.workflowConfig);
    const drivers = configuredDrivers(command.runtimeConfig);
    let sandboxPolicy: SandboxPolicy | undefined;
    if (command.sandboxConfig !== undefined) {
      const file = Bun.file(command.sandboxConfig);
      if (file.size > 65536) throw new Error('Sandbox config too large');
      let value: unknown;
      try {
        value = JSON.parse(await file.text());
      } catch {
        throw new Error('Cannot read Sandbox config JSON');
      }
      sandboxPolicy = validateSandboxPolicy(value);
    }
    let lease: DatabaseLease | undefined;
    try {
      await runLocalDaemon(command.socket, command.interval, () => {
        lease = acquireDatabaseLease(command.db);
        return openOperations(
          lease.databasePath,
          drivers,
          command.wakeUp,
          sandboxPolicy,
          workflow,
          command.consolidationRooms,
          command.delegationRooms,
          command.extractionRooms,
          command.observeWorkflows,
        );
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
