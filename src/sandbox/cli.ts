import { configuredSandboxCredentials, runGrantedSandbox } from './credentials.js';
import { SqliteEventBus } from '../events/sqlite.js';
import { releaseResources } from '../daemon/service.js';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { SqliteTaskProvider } from '../tasks/sqlite.js';
import { SqliteAgentRepository } from '../agents/sqlite.js';
import { runProcess } from '../runtime/process.js';
import { runDockerSandbox } from './docker.js';
import { saveSandboxArtifact, readSandboxArtifact } from './artifact.js';
import {
  validateSandboxInput,
  validateSandboxPolicy,
  type SandboxInput,
  type SandboxPolicy,
} from './domain.js';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { parseSandboxProposal } from './proposal.js';
import { runSandboxTask } from './service.js';
export type SandboxCommand = { readonly db: string; readonly json: boolean } & (
  | ({ readonly action: 'run'; readonly taskId: string; readonly credentialConfig?: string } & (
      | { readonly input: SandboxInput }
      | { readonly proposalId: string; readonly policy: SandboxPolicy }
    ))
  | { readonly action: 'artifact'; readonly uri: string }
  | { readonly action: 'cancel'; readonly taskId: string }
  | { readonly action: 'list' }
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
      'credential-config': { type: 'string' },
      proposal: { type: 'string' },
      file: { type: 'string', multiple: true },
      repo: { type: 'string' },
      writable: { type: 'boolean' },
      'timeout-ms': { type: 'string' },
      'max-output-bytes': { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (noun !== 'sandbox' || extra.length || (action !== 'list' && !target?.trim()))
    throw new Error('Expected sandbox run TASK --code TS or sandbox artifact URI');
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim() || db === ':memory:') throw new Error('Sandbox requires persistent DB');
  const base = { db, json: parsed.values.json ?? false };
  if (action === 'list') {
    if (
      target !== undefined ||
      Object.keys(parsed.values).some((key) => !['db', 'json'].includes(key))
    )
      throw new Error('Unexpected sandbox list argument');
    return { ...base, action };
  }
  if (!target) throw new Error('Sandbox target required');
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
  const credentialConfig = parsed.values['credential-config'];
  if (credentialConfig !== undefined && !credentialConfig.trim())
    throw new Error('Invalid credential config path');
  const credential = credentialConfig === undefined ? {} : { credentialConfig };
  const policy = validateSandboxPolicy({
    ...(parsed.values.repo === undefined ? {} : { repo: parsed.values.repo }),
    writable: parsed.values.writable ?? false,
    files: parsed.values.file ?? [],
    timeoutMs: Number(parsed.values['timeout-ms'] ?? 30000),
    maxOutputBytes: Number(parsed.values['max-output-bytes'] ?? 65536),
  });
  if (parsed.values.proposal !== undefined) {
    if (!parsed.values.proposal.trim() || parsed.values.code !== undefined)
      throw new Error('Choose --code or --proposal');
    return {
      ...base,
      ...credential,
      action,
      taskId: target,
      proposalId: parsed.values.proposal,
      policy,
    };
  }
  return {
    ...base,
    action,
    ...credential,
    taskId: target,
    input: validateSandboxInput({ ...policy, code: parsed.values.code ?? '' }),
  };
}
export async function runSandboxCommand(
  command: SandboxCommand,
  output: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (command.action === 'cancel' || command.action === 'list')
    throw new Error('Sandbox list/cancel requires daemon');
  const directory = command.db + '.artifacts';
  if (command.action === 'artifact') {
    output(await readSandboxArtifact(directory, command.uri));
    return;
  }
  const credentialConfiguration = await configuredSandboxCredentials(command.credentialConfig);
  const controller = signal === undefined ? new AbortController() : undefined;
  const interrupt = () => controller?.abort();
  if (controller) {
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  }
  let events: SqliteEventBus | undefined;
  let tasks: SqliteTaskProvider | undefined;
  let agents: SqliteAgentRepository | undefined;
  let rooms: SqliteRoomRepository | undefined;
  try {
    tasks = new SqliteTaskProvider(command.db);
    agents = new SqliteAgentRepository(command.db);
    const task = tasks.get(command.taskId);
    const agent = agents.list().find((a) => a.id === task.owner);
    if (!agent) throw new Error('Task owner Agent not found');
    let input: SandboxInput;
    let proposalRef: string | undefined;
    if ('proposalId' in command) {
      const proposalRooms = new SqliteRoomRepository(command.db);
      rooms = proposalRooms;
      const candidates = proposalRooms
        .list()
        .filter((room) => room.taskId === task.id)
        .flatMap((room) =>
          proposalRooms
            .messages(room.id)
            .filter((message) => message.id === command.proposalId)
            .map((message) => ({ room, message })),
        );
      if (candidates.length !== 1 || !candidates[0])
        throw new Error('Sandbox proposal Message not found');
      const { room, message } = candidates[0];
      input = validateSandboxInput({
        ...command.policy,
        code: parseSandboxProposal(task, room, message),
      });
      proposalRef = `org://rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(message.id)}`;
    } else input = command.input;
    events = new SqliteEventBus(command.db);
    const taskProvider = tasks;
    const agentRepository = agents;
    const result = await runSandboxTask(
      tasks,
      agent,
      (input) =>
        runGrantedSandbox(
          { tasks: taskProvider, agents: agentRepository },
          credentialConfiguration.secrets,
          credentialConfiguration.grants,
          command.taskId,
          input,
          (input, credentials) =>
            runDockerSandbox(
              runProcess,
              {
                executable: 'docker',
                credentials,
                env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
                cwd: process.cwd(),
                uid: process.getuid?.() ?? 0,
                gid: process.getgid?.() ?? 0,
              },
              input,
              signal ?? controller?.signal,
            ),
        ),
      (bytes) => saveSandboxArtifact(directory, bytes),
      input,
      command.taskId,
      () => new Date().toISOString(),
      randomUUID,
      proposalRef,
      {
        events,
        digest: (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      },
    );
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    try {
      releaseResources(
        [events, rooms, agents, tasks].flatMap((resource) => (resource ? [resource] : [])),
      );
    } finally {
      if (controller) {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
      }
    }
  }
}
