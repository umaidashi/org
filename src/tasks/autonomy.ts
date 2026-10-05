import { createRoom } from '../rooms/domain.js';
import type { Identity, Message } from '../rooms/domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { Session } from '../sessions/domain.js';
import type { SessionStore } from '../sessions/port.js';
import type { Task } from './domain.js';
import type { TaskProvider } from './port.js';
export async function pollExecutionTasks(
  tasks: Pick<TaskProvider, 'list' | 'get' | 'update'>,
  rooms: Pick<RoomRepository, 'list' | 'create' | 'messages' | 'append'>,
  sessions: Pick<SessionStore, 'list'>,
  open: (agentId: string, roomId: string) => Session,
  run: (
    taskId: string,
    sessionId: string,
    messageId: string,
  ) => Promise<{ readonly task: Task; readonly reply: Message }>,
  identity: () => Identity,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  for (const candidate of tasks.list({ kind: 'execution_task', status: 'assigned' })) {
    if (signal?.aborted) return;
    const task = tasks.get(candidate.id);
    if (
      task.kind !== 'execution_task' ||
      task.status !== 'assigned' ||
      task.owner === null ||
      task.dependencies.some((id) => tasks.get(id).status !== 'completed')
    )
      continue;
    const owner = task.owner;
    try {
      let room = rooms
        .list()
        .find(
          (r) =>
            r.type === 'task' &&
            r.taskId === task.id &&
            r.archivedAt === null &&
            r.participants.some((p) => p.kind === 'agent' && p.id === owner),
        );
      if (!room)
        room = rooms.create(
          createRoom(
            {
              title: 'Execution: ' + task.title,
              type: 'task',
              taskId: task.id,
              participants: [{ kind: 'agent', id: owner }],
            },
            identity(),
          ),
        );
      const candidates = sessions.list().filter((s) => s.roomId === room.id && s.agentId === owner);
      if (candidates.some((s) => s.status === 'running')) continue;
      const session = candidates.find((s) => s.status === 'idle') ?? open(owner, room.id);
      if (session.agentId !== owner || session.roomId !== room.id || session.status !== 'idle')
        throw new Error('Automatic Task Session mismatch');
      const source =
        rooms
          .messages(room.id)
          .find(
            (m) =>
              m.sender.kind === 'agent' &&
              m.sender.id === owner &&
              m.metadata.executionTaskId === task.id &&
              m.metadata.inputTaskVersion === task.version,
          ) ??
        rooms.append(
          room.id,
          {
            sender: { kind: 'agent', id: owner },
            content: task.objective,
            metadata: { executionTaskId: task.id, inputTaskVersion: task.version },
          },
          identity(),
        );
      const result = await run(task.id, session.id, source.id);
      if (result.task.id !== task.id || result.task.status !== 'waiting_approval')
        throw new Error('Automatic Task result mismatch');
    } catch (error) {
      const current = tasks.get(task.id);
      if (current.status === 'assigned' && current.version === task.version)
        tasks.update(task.id, { status: 'failed' }, identity().createdAt, task.version);
      else if (current.status === 'running') throw error;
    }
  }
}
