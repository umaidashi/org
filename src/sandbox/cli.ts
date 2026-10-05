import { releaseResources } from '../daemon/service.js';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { runProcess } from '../runtime/process.js';
import { runDockerSandbox } from './docker.js';
import { saveSandboxArtifact, readSandboxArtifact } from './artifact.js';
import { validateSandboxInput, type SandboxInput } from './domain.js';
import { runSandboxTask } from './service.js';
export type SandboxCommand = { readonly db: string; readonly json: boolean } & (
  | { readonly action: 'run'; readonly taskId: string; readonly input: SandboxInput }
  | { readonly action: 'artifact'; readonly uri: string }
  | { readonly action: 'cancel'; readonly taskId: string }
);
export function parseSandboxCommand(argv: string[]): SandboxCommand {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      code: { type: 'string' },
      file: { type: 'string', multiple: true },
      repo: { type: 'string' },
      writable: { type: 'boolean' },
      'timeout-ms': { type: 'string' },
      'max-output-bytes': { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (noun !== 'sandbox' || extra.length || !target?.trim())
    throw new Error('Expected sandbox run TASK --code TS or sandbox artifact URI');
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim() || db === ':memory:') throw new Error('Sandbox requires persistent DB');
  const base = { db, json: parsed.values.json ?? false };
  if (action === 'cancel') {
    for (const key of Object.keys(parsed.values))
      if (!['db', 'json'].includes(key)) throw new Error(`Unexpected --${key}`);
    return { ...base, action, taskId: target };
  }
  if (action === 'artifact') {
    for (const key of Object.keys(parsed.values))
      if (!['db', 'json'].includes(key)) throw new Error(`Unexpected --${key}`);
    if (!/^org:\/\/artifacts\/[a-f0-9]{64}$/.test(target)) throw new Error('Invalid Artifact URI');
    return { ...base, action, uri: target };
  }
  if (action !== 'run') throw new Error('Expected sandbox run|artifact|cancel');
  return {
    ...base,
    action,
    taskId: target,
    input: validateSandboxInput({
      ...(parsed.values.repo === undefined ? {} : { repo: parsed.values.repo }),
      code: parsed.values.code ?? '',
      writable: parsed.values.writable ?? false,
      files: parsed.values.file ?? [],
      timeoutMs: Number(parsed.values['timeout-ms'] ?? 30000),
      maxOutputBytes: Number(parsed.values['max-output-bytes'] ?? 65536),
    }),
  };
}
export async function runSandboxCommand(
  command: SandboxCommand,
  output: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (command.action === 'cancel') throw new Error('Sandbox cancel requires daemon');
  const directory = command.db + '.artifacts';
  if (command.action === 'artifact') {
    output(await readSandboxArtifact(directory, command.uri));
    return;
  }
  const controller = signal === undefined ? new AbortController() : undefined;
  const interrupt = () => controller?.abort();
  if (controller) {
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  }
  let tasks: SqliteTaskProvider | undefined;
  let agents: SqliteAgentRepository | undefined;
  try {
    tasks = new SqliteTaskProvider(command.db);
    agents = new SqliteAgentRepository(command.db);
    const task = tasks.get(command.taskId);
    const agent = agents.list().find((a) => a.id === task.owner);
    if (!agent) throw new Error('Task owner Agent not found');
    const result = await runSandboxTask(
      tasks,
      agent,
      (input) =>
        runDockerSandbox(
          runProcess,
          {
            executable: 'docker',
            env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
            cwd: process.cwd(),
            uid: process.getuid?.() ?? 0,
            gid: process.getgid?.() ?? 0,
          },
          input,
          signal ?? controller?.signal,
        ),
      (bytes) => saveSandboxArtifact(directory, bytes),
      command.input,
      command.taskId,
      () => new Date().toISOString(),
      randomUUID,
    );
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    try {
      releaseResources([agents, tasks].flatMap((resource) => (resource ? [resource] : [])));
    } finally {
      if (controller) {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
      }
    }
  }
}
