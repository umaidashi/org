import { requireCapability, type Agent } from '../agents/domain.js';
import type { Task } from '../tasks/domain.js';

export interface SandboxInput {
  readonly code: string;
  readonly writable: boolean;
  readonly files: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly repo?: string;
}

export function validateSandboxInput(input: SandboxInput): SandboxInput {
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 65536)
    throw new Error('Sandbox code must contain 1–65536 characters');
  if (typeof input.writable !== 'boolean') throw new Error('Invalid Sandbox writable flag');
  for (const [value, maximum] of [
    [input.timeoutMs, 3600000],
    [input.maxOutputBytes, 1048576],
  ])
    if (
      !Number.isSafeInteger(value) ||
      value === undefined ||
      maximum === undefined ||
      value < 1 ||
      value > maximum
    )
      throw new Error('Invalid Sandbox resource limit');
  if (
    !Array.isArray(input.files) ||
    input.files.length > 16 ||
    new Set(input.files).size !== input.files.length
  )
    throw new Error('Invalid Sandbox artifact paths');
  for (const file of Array.from(input.files)) {
    if (
      typeof file !== 'string' ||
      file.length > 1024 ||
      file.includes('\\') ||
      file.includes('\0') ||
      file.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Invalid Sandbox artifact path');
  }
  if (
    input.repo !== undefined &&
    (typeof input.repo !== 'string' || !input.repo.trim() || input.repo.includes('\0'))
  )
    throw new Error('Invalid Sandbox repo path');
  return { ...input, files: Array.from(input.files, (file: string) => file) };
}

export function authorizeSandboxTask(task: Task, agent: Agent, input: SandboxInput): void {
  validateSandboxInput(input);
  if (task.kind !== 'execution_task') throw new Error('Sandbox requires an ExecutionTask');
  if (task.owner !== agent.id) throw new Error('Sandbox Task owner does not match Agent');
  if (task.status !== 'assigned') throw new Error('Sandbox Task must be assigned');
  requireCapability(agent, 'can_run_shell');
  if (input.repo !== undefined) requireCapability(agent, 'can_read');
  if (input.writable) requireCapability(agent, 'can_write');
}

export class SandboxCancelledError extends Error {}
