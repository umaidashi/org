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
type RuntimeConfiguration = Partial<Record<'codex' | 'claude', DriverConfig>> & {
  readonly agents?: Readonly<Record<string, Partial<Record<'codex' | 'claude', DriverConfig>>>>;
};
type Driver = (input: RuntimeTurnInput, signal?: AbortSignal) => Promise<RuntimeTurnResult>;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseRuntimeConfig(
  value: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeConfiguration {
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== 'codex' && key !== 'claude' && key !== 'agents')
  )
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
    const names = entry.env === undefined ? [] : entry.env;
    if (!Array.isArray(names) && !record(names))
      throw new Error('Runtime env must select host environment variable names');
    const selections = Array.isArray(names)
      ? names.map((name: unknown) => [name, name] as const)
      : Object.entries(names);
    const env = Object.fromEntries<string>(
      selections.map(([name, source]) => {
        if (
          typeof name !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
          typeof source !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source)
        )
          throw new Error('Runtime env must select host environment variable names');
        const secret = Object.hasOwn(environment, source) ? environment[source] : undefined;
        if (typeof secret !== 'string') throw new Error('Runtime environment variable not set');
        return [name, secret];
      }),
    );
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
  if (value.agents === undefined) return result;
  if (!record(value.agents)) throw new Error('Invalid Agent runtime profiles');
  const agents = Object.fromEntries<Partial<Record<'codex' | 'claude', DriverConfig>>>(
    Object.entries(value.agents).map(([id, profile]) => {
      if (
        !id.trim() ||
        id.length > 128 ||
        id.includes('\0') ||
        !record(profile) ||
        Object.keys(profile).some((key) => key !== 'codex' && key !== 'claude') ||
        (profile.codex === undefined && profile.claude === undefined)
      )
        throw new Error('Invalid Agent runtime profile');
      return [id, parseRuntimeConfig(profile, environment)];
    }),
  );
  return { ...result, agents };
}
export function configuredDrivers(path?: string): Readonly<Record<'codex' | 'claude', Driver>> {
  const value: unknown = path === undefined ? {} : JSON.parse(readFileSync(path, 'utf8'));
  const configuration = parseRuntimeConfig(value, process.env);
  const driver =
    (kind: 'codex' | 'claude'): Driver =>
    async (input, signal) => {
      const profiles = configuration.agents;
      const config =
        profiles && Object.hasOwn(profiles, input.agent.id)
          ? profiles[input.agent.id]?.[kind]
          : configuration[kind];
      if (!config)
        throw new Error(`Runtime ${kind} is not configured; use daemon --runtime-config`);
      const run = kind === 'codex' ? runCodexTurn : runClaudeTurn;
      return run(runProcess, input, { ...config, ...(signal ? { signal } : {}) });
    };
  return { codex: driver('codex'), claude: driver('claude') };
}
