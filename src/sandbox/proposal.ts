import type { Task } from '../tasks/domain.js';
import type { Room, Message } from '../rooms/domain.js';
import { validateSandboxCode } from './domain.js';
export function parseSandboxProposal(task: Task, room: Room, message: Message): string {
  if (
    task.kind !== 'execution_task' ||
    task.status !== 'assigned' ||
    task.owner === null ||
    room.type !== 'task' ||
    room.taskId !== task.id ||
    room.archivedAt !== null ||
    message.roomId !== room.id ||
    message.sender.kind !== 'agent' ||
    message.sender.id !== task.owner ||
    !room.participants.some((p) => p.kind === 'agent' && p.id === task.owner)
  )
    throw new Error('Sandbox proposal requires owner Agent in active Task Room');
  const value: unknown = JSON.parse(message.content);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== 1 ||
    !('tool' in value) ||
    value.tool !== 'sandbox' ||
    !('code' in value) ||
    typeof value.code !== 'string' ||
    Object.keys(value).some((key) => !['version', 'tool', 'code'].includes(key))
  )
    throw new Error('Invalid Sandbox proposal');
  return validateSandboxCode(value.code);
}
