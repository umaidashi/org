import { requireTaskOwnerMessage } from '../tasks/proposal.js';
import type { Task } from '../tasks/domain.js';
import type { Room, Message } from '../rooms/domain.js';
import { validateSandboxCode } from './domain.js';
export function parseSandboxProposal(
  task: Task,
  room: Room,
  message: Message,
  runningVersion?: number,
): string {
  requireTaskOwnerMessage(task, room, message, runningVersion);
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
