import type { AgentRepository } from '../agents/port.js';
import type { Task } from './domain.js';
import type { TaskProvider } from './port.js';
import type { RoomRepository } from '../rooms/port.js';
export function readTaskRoomArtifact(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  taskId: string,
  uri: string,
): string {
  const match = /^org:\/\/rooms\/([^/]+)\/messages\/([^/]+)$/.exec(uri);
  if (!match?.[1] || !match[2]) throw new Error('Invalid Room Artifact URI');
  const roomId = decodeURIComponent(match[1]);
  const messageId = decodeURIComponent(match[2]);
  if (uri !== `org://rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`)
    throw new Error('Invalid Room Artifact URI');
  const room = rooms.get(roomId);
  if (room.id !== roomId || room.type !== 'task' || room.taskId !== taskId)
    throw new Error('Artifact Room does not belong to Task');
  const message = rooms.messages(room.id).find((m) => m.id === messageId && m.roomId === room.id);
  if (!message) throw new Error('Artifact Message not found');
  return message.content;
}
export function recoverInterruptedExecutionTasks(
  provider: Pick<TaskProvider, 'list' | 'update'>,
  now: () => string,
  pendingResult?: (task: Task) => boolean,
): void {
  for (const task of provider.list({ kind: 'execution_task', status: 'running' })) {
    if (task.kind === 'execution_task' && task.status === 'running')
      provider.update(
        task.id,
        { status: pendingResult?.(task) ? 'blocked' : 'failed' },
        now(),
        task.version,
      );
  }
}
export function assignTask(
  provider: Pick<TaskProvider, 'update'>,
  agents: Pick<AgentRepository, 'list'>,
  id: string,
  owner: string,
  at: string,
): Task {
  if (!agents.list().some((agent) => agent.id === owner))
    throw new Error(`Agent ${JSON.stringify(owner)} not found`);
  return provider.update(id, { owner }, at);
}
