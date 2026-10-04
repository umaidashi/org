import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { runProcess } from './process.js';
import { runCodexTurn } from './codex.js';
import { runClaudeTurn } from './claude.js';
import type { RuntimeTurnInput, RuntimeTurnResult } from './port.js';
export interface DriverConfig {
  readonly executable: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}
type Driver = (input: RuntimeTurnInput, signal?: AbortSignal) => Promise<RuntimeTurnResult>;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseRuntimeConfig(
  value: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): Partial<Record<'codex' | 'claude', DriverConfig>> {
  if (!record(value) || Object.keys(value).some((key) => key !== 'codex' && key !== 'claude'))
    throw new Error('Invalid runtime configuration');
  const result: Partial<Record<'codex' | 'claude', DriverConfig>> = {};
  for (const kind of ['codex', 'claude'] as const) {
    const entry = value[kind];
    if (entry === undefined) continue;
    if (
      !record(entry) ||
      Object.keys(entry).some(
        (key) => !['executable', 'cwd', 'env', 'timeoutMs', 'maxOutputBytes'].includes(key),
      ) ||
      typeof entry.executable !== 'string' ||
      !isAbsolute(entry.executable) ||
      entry.executable.includes('\0') ||
      typeof entry.cwd !== 'string' ||
      !isAbsolute(entry.cwd) ||
      entry.cwd.includes('\0')
    )
      throw new Error('Runtime executable/cwd must be absolute paths');
    const names = entry.env ?? [];
    if (
      !Array.isArray(names) ||
      !names.every(
        (name: unknown) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
      )
    )
      throw new Error('Runtime env must contain environment variable names');
    const env: Record<string, string> = {};
    for (const name of names) {
      if (typeof name !== 'string') throw new Error('Invalid runtime env name');
      const secret = environment[name];
      if (secret === undefined) throw new Error(`Runtime environment variable not set: ${name}`);
      env[name] = secret;
    }
    const timeoutMs = entry.timeoutMs ?? 120000;
    const maxOutputBytes = entry.maxOutputBytes ?? 1048576;
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 2147483647 ||
      typeof maxOutputBytes !== 'number' ||
      !Number.isSafeInteger(maxOutputBytes) ||
      maxOutputBytes <= 0
    )
      throw new Error('Invalid runtime limits');
    result[kind] = { executable: entry.executable, cwd: entry.cwd, env, timeoutMs, maxOutputBytes };
  }
  return result;
}
export function configuredDrivers(path?: string): Readonly<Record<'codex' | 'claude', Driver>> {
  const value: unknown = path === undefined ? {} : JSON.parse(readFileSync(path, 'utf8'));
  const configuration = parseRuntimeConfig(value, process.env);
  const driver =
    (kind: 'codex' | 'claude'): Driver =>
    async (input, signal) => {
      const config = configuration[kind];
      if (!config)
        throw new Error(`Runtime ${kind} is not configured; use daemon --runtime-config`);
      const run = kind === 'codex' ? runCodexTurn : runClaudeTurn;
      return run(runProcess, input, { ...config, ...(signal ? { signal } : {}) });
    };
  return { codex: driver('codex'), claude: driver('claude') };
}
