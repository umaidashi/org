export class TaskResultPendingError extends Error {}
import type { TaskProvider, ExecutionResultWriter } from './port.js';
import type { TaskArtifact, Task } from './domain.js';
import type { SessionStore } from '../sessions/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { Message } from '../rooms/domain.js';
import { changeTask } from './domain.js';
import { isDeepStrictEqual } from 'node:util';
function verifyExecutionTaskResult(
  tasks: Pick<TaskProvider, 'get' | 'history'>,
  sessions: Pick<SessionStore, 'get'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  input: {
    readonly taskId: string;
    readonly sessionId: string;
    readonly messageId: string;
    readonly expectedVersion: number;
  },
  phase: 'running' | 'blocked',
) {
  const current = tasks.get(input.taskId);
  if (
    current.kind !== 'execution_task' ||
    current.status !== phase ||
    current.owner === null ||
    current.version !== input.expectedVersion ||
    current.outputArtifacts.length !== 0
  )
    throw new Error('Result recovery requires current matching ExecutionTask');
  const session = sessions.get(input.sessionId);
  const room = rooms.get(session.roomId);
  if (
    session.agentId !== current.owner ||
    session.status === 'running' ||
    room.type !== 'task' ||
    room.taskId !== current.id ||
    room.id !== session.roomId ||
    room.archivedAt !== null ||
    !room.participants.some((p) => p.kind === 'agent' && p.id === current.owner)
  )
    throw new Error('Result recovery requires original Session and active Task Room');
  const messages = rooms.messages(room.id);
  const message = messages.find((m) => m.id === input.messageId && m.roomId === room.id);
  const reference = message?.metadata.taskExecution;
  if (
    !message ||
    message.sender.kind !== 'agent' ||
    message.sender.id !== current.owner ||
    message.metadata.sessionId !== session.id ||
    message.replyTo === null ||
    !messages.some((m) => m.id === message.replyTo && m.roomId === room.id) ||
    reference === null ||
    typeof reference !== 'object' ||
    Array.isArray(reference) ||
    Object.keys(reference).some((k) => !['taskId', 'version'].includes(k)) ||
    !('taskId' in reference) ||
    reference.taskId !== current.id ||
    !('version' in reference) ||
    typeof reference.version !== 'number' ||
    !Number.isSafeInteger(reference.version) ||
    reference.version < 1
  )
    throw new Error('Task result execution reference missing or mismatched');
  const history = tasks.history(current.id);
  const index = history.findIndex((h) => h.version === reference.version);
  let previous = history[index]?.task;
  if (
    !previous ||
    previous.id !== current.id ||
    previous.version !== reference.version ||
    previous.status !== 'running' ||
    previous.owner !== current.owner ||
    previous.outputArtifacts.length !== 0 ||
    !isDeepStrictEqual(history.at(-1)?.task, current)
  )
    throw new Error('Task result execution history missing');
  for (const entry of history.slice(index + 1)) {
    if (
      !['blocked', 'running'].includes(entry.status) ||
      entry.version !== entry.task.version ||
      !isDeepStrictEqual(changeTask(previous, { status: entry.status }, entry.at), entry.task)
    )
      throw new Error('Task result snapshot changed since execution');
    previous = entry.task;
  }
  if (current.dependencies.some((id) => tasks.get(id).status !== 'completed'))
    throw new Error('Task dependencies are not complete');
  return { task: current, message, room };
}
export function recoverExecutionTaskResult(
  tasks: Pick<TaskProvider, 'get' | 'history' | 'update'> & ExecutionResultWriter,
  sessions: Pick<SessionStore, 'get'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  input: {
    readonly taskId: string;
    readonly sessionId: string;
    readonly messageId: string;
    readonly expectedVersion: number;
  },
  now: () => string,
): Task {
  const {
    task: blocked,
    message,
    room,
  } = verifyExecutionTaskResult(tasks, sessions, rooms, input, 'blocked');
  const running = tasks.update(blocked.id, { status: 'running' }, now(), blocked.version);
  try {
    return stagePendingExecutionResult(tasks, running, {
      id: message.id,
      uri: `org://rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(message.id)}`,
      createdAt: now(),
    });
  } catch (error) {
    try {
      tasks.update(running.id, { status: 'blocked' }, now(), running.version);
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Task result recovery failed and state could not be recorded',
      );
    }
    throw error;
  }
}
export function hasVerifiedInterruptedTaskResult(
  tasks: Pick<TaskProvider, 'get' | 'history'>,
  sessions: Pick<SessionStore, 'get'>,
  rooms: Pick<RoomRepository, 'list' | 'get' | 'messages'>,
  task: Task,
): boolean {
  if (
    task.kind !== 'execution_task' ||
    task.status !== 'running' ||
    task.owner === null ||
    task.outputArtifacts.length !== 0
  )
    return false;
  // ponytail: scan local Room history; add an indexed result-reference query if startup cost warrants it.
  const candidates = rooms
    .list()
    .filter((room) => room.type === 'task' && room.taskId === task.id)
    .flatMap((room) => rooms.messages(room.id))
    .filter((message) => {
      const reference = message.metadata.taskExecution;
      return (
        reference !== null &&
        typeof reference === 'object' &&
        !Array.isArray(reference) &&
        'taskId' in reference &&
        reference.taskId === task.id &&
        'version' in reference &&
        reference.version === task.version
      );
    });
  if (candidates.length === 0) return false;
  if (candidates.length !== 1) throw new Error('Interrupted Task result is ambiguous');
  const message = candidates[0];
  if (!message) throw new Error('Interrupted Task result missing');
  if (typeof message.metadata.sessionId !== 'string')
    throw new Error('Task result Session reference missing');
  verifyExecutionTaskResult(
    tasks,
    sessions,
    rooms,
    {
      taskId: task.id,
      sessionId: message.metadata.sessionId,
      messageId: message.id,
      expectedVersion: task.version,
    },
    'running',
  );
  return true;
}
export function stagePendingExecutionResult(
  provider: ExecutionResultWriter,
  running: Task,
  artifact: TaskArtifact,
): Task {
  try {
    return provider.stageExecutionResult(running.id, artifact, running.version);
  } catch (error) {
    throw new TaskResultPendingError('Task result remains pending', { cause: error });
  }
}
export async function runExecutionTask(
  provider: Pick<TaskProvider, 'get' | 'update'> & ExecutionResultWriter,
  sessions: Pick<SessionStore, 'get'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  reply: (
    sessionId: string,
    messageId: string,
    instruction: string,
    running: Task,
  ) => Promise<Message>,
  input: {
    readonly taskId: string;
    readonly sessionId: string;
    readonly messageId: string;
    readonly instruction?: string;
  },
  now: () => string,
  produceArtifact?: (running: Task, reply: Message) => Promise<TaskArtifact | null>,
): Promise<{ readonly task: Task; readonly reply: Message }> {
  const original = provider.get(input.taskId);
  if (
    original.kind !== 'execution_task' ||
    original.status !== 'assigned' ||
    original.owner === null
  )
    throw new Error('Task execution requires assigned ExecutionTask');
  const session = sessions.get(input.sessionId);
  if (session.agentId !== original.owner || session.status !== 'idle')
    throw new Error('Task owner requires idle matching Session');
  const room = rooms.get(session.roomId);
  if (
    room.id !== session.roomId ||
    room.taskId !== original.id ||
    room.archivedAt !== null ||
    !room.participants.some((p) => p.kind === 'agent' && p.id === session.agentId)
  )
    throw new Error('Task execution requires matching active Task Room');
  const messages = rooms.messages(room.id);
  if (messages.some((m) => m.replyTo === input.messageId && m.metadata.sessionId === session.id))
    throw new Error('Task input already has a Session reply; use a new Message');
  if (!messages.some((m) => m.id === input.messageId && m.roomId === room.id))
    throw new Error('Task input Message not found');
  const execution = await executeAssignedTask(provider, original, now, async (running) => {
    const result = await reply(
      session.id,
      input.messageId,
      JSON.stringify({
        task: { id: original.id, title: original.title, objective: original.objective },
        instruction: input.instruction ?? 'Produce the Task result for human review.',
      }),
      running,
    );
    if (
      result.roomId !== room.id ||
      result.replyTo !== input.messageId ||
      result.sender.kind !== 'agent' ||
      result.sender.id !== original.owner
    )
      throw new Error('Task runtime result does not match execution');
    return {
      result,
      artifact: produceArtifact
        ? await produceArtifact(running, result)
        : {
            id: result.id,
            uri: `org://rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(result.id)}`,
            createdAt: now(),
          },
    };
  });
  return { task: execution.task, reply: execution.result };
}

export async function executeAssignedTask<T>(
  provider: Pick<TaskProvider, 'update'> & ExecutionResultWriter,
  original: Task,
  now: () => string,
  produce: (
    running: Task,
  ) => Promise<{ readonly result: T; readonly artifact: TaskArtifact | null }>,
): Promise<{ readonly task: Task; readonly result: T }> {
  if (
    original.kind !== 'execution_task' ||
    original.status !== 'assigned' ||
    original.owner === null
  )
    throw new Error('Task execution requires assigned ExecutionTask');
  const running = provider.update(original.id, { status: 'running' }, now(), original.version);
  try {
    const { result, artifact } = await produce(running);
    const task =
      artifact === null
        ? provider.update(original.id, { status: 'waiting_approval' }, now(), running.version)
        : stagePendingExecutionResult(provider, running, artifact);
    return { task, result };
  } catch (error) {
    try {
      provider.update(
        original.id,
        { status: error instanceof TaskResultPendingError ? 'blocked' : 'failed' },
        now(),
        running.version,
      );
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Task execution failed and state could not be recorded',
      );
    }
    throw error;
  }
}
