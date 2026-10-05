import type { Task } from './domain.js';
import type { Room, Message } from '../rooms/domain.js';

export function requireTaskOwnerMessage(
  task: Task,
  room: Room,
  message: Message,
  runningVersion?: number,
): void {
  if (
    task.kind !== 'execution_task' ||
    (runningVersion === undefined
      ? task.status !== 'assigned'
      : task.status !== 'running' || task.version !== runningVersion) ||
    task.owner === null ||
    room.type !== 'task' ||
    room.taskId !== task.id ||
    room.archivedAt !== null ||
    message.roomId !== room.id ||
    message.sender.kind !== 'agent' ||
    message.sender.id !== task.owner ||
    !room.participants.some((p) => p.kind === 'agent' && p.id === task.owner)
  )
    throw new Error('Task proposal requires owner Agent in active Task Room');
}
