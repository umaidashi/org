export class TaskResultPendingError extends Error {}
import type { TaskProvider, ExecutionResultWriter } from './port.js';
import type { TaskArtifact, Task } from './domain.js';
import type { SessionStore } from '../sessions/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { Message } from '../rooms/domain.js';
export async function runExecutionTask(
  provider: Pick<TaskProvider, 'get' | 'update'> & ExecutionResultWriter,
  sessions: Pick<SessionStore, 'get'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  reply: (sessionId: string, messageId: string, instruction: string) => Promise<Message>,
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
        : provider.stageExecutionResult(original.id, artifact, running.version);
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
