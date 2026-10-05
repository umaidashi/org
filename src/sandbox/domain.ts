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

export type SandboxPolicy = Omit<SandboxInput, 'code'>;

export function validateSandboxInput(input: SandboxInput): SandboxInput {
  validateSandboxCode(input.code);
  const { code, ...policy } = input;
  return { ...validateSandboxPolicy(policy), code };
}

export function validateSandboxCode(code: unknown): string {
  if (typeof code !== 'string' || !code.trim() || code.length > 65536)
    throw new Error('Sandbox code must contain 1–65536 characters');
  return code;
}

export function validateSandboxPolicy(input: unknown): SandboxPolicy {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['writable', 'files', 'timeoutMs', 'maxOutputBytes', 'repo'].includes(key),
    ) ||
    !('writable' in input) ||
    !('files' in input) ||
    !('timeoutMs' in input) ||
    !('maxOutputBytes' in input)
  )
    throw new Error('Invalid Sandbox host policy');
  if (typeof input.writable !== 'boolean') throw new Error('Invalid Sandbox writable flag');
  for (const [value, maximum] of [
    [input.timeoutMs, 3600000],
    [input.maxOutputBytes, 1048576],
  ] as const)
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
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
    'repo' in input &&
    input.repo !== undefined &&
    (typeof input.repo !== 'string' || !input.repo.trim() || input.repo.includes('\0'))
  )
    throw new Error('Invalid Sandbox repo path');
  if (typeof input.timeoutMs !== 'number' || typeof input.maxOutputBytes !== 'number')
    throw new Error('Invalid Sandbox resource limit');
  const repo = 'repo' in input ? input.repo : undefined;
  if (repo !== undefined && typeof repo !== 'string') throw new Error('Invalid Sandbox repo path');
  return {
    writable: input.writable,
    files: Array.from(input.files, (file: unknown) => {
      if (typeof file !== 'string') throw new Error('Invalid Sandbox artifact path');
      return file;
    }),
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
    ...(repo === undefined ? {} : { repo }),
  };
}

export function authorizeSandboxTask(
  task: Task,
  agent: Agent,
  input: SandboxInput,
  runningVersion?: number,
): void {
  validateSandboxInput(input);
  if (task.kind !== 'execution_task') throw new Error('Sandbox requires an ExecutionTask');
  if (task.owner !== agent.id) throw new Error('Sandbox Task owner does not match Agent');
  if (
    runningVersion === undefined
      ? task.status !== 'assigned'
      : task.status !== 'running' || task.version !== runningVersion
  )
    throw new Error('Sandbox Task requires assigned state or matching running version');
  requireCapability(agent, 'can_run_shell');
  if (input.repo !== undefined) requireCapability(agent, 'can_read');
  if (input.writable) requireCapability(agent, 'can_write');
}

export class SandboxCancelledError extends Error {}
