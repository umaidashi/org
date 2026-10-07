import type { AgentRepository } from '../agents/port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { SecretStore } from '../secrets/port.js';
import { EnvironmentSecretStore } from '../secrets/environment.js';
import { authorizeSandboxTask, type SandboxInput } from './domain.js';

export type SandboxCredentialGrant = {
  readonly agentId: string;
  readonly taskId: string;
  readonly environmentVariable: string;
  readonly reference: string;
  readonly sourceEnvironmentVariable: string;
};
export function parseSandboxCredentialGrants(value: unknown): readonly SandboxCredentialGrant[] {
  if (!Array.isArray(value) || value.length > 64)
    throw new Error('Invalid Sandbox credential grants');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some(
        (key) =>
          ![
            'agentId',
            'taskId',
            'environmentVariable',
            'reference',
            'sourceEnvironmentVariable',
          ].includes(key),
      ) ||
      !('agentId' in entry) ||
      typeof entry.agentId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(entry.agentId) ||
      !('taskId' in entry) ||
      typeof entry.taskId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(entry.taskId) ||
      !('environmentVariable' in entry) ||
      typeof entry.environmentVariable !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,120}_(TOKEN|KEY|SECRET|PASSWORD)$/.test(entry.environmentVariable) ||
      !('reference' in entry) ||
      typeof entry.reference !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(entry.reference) ||
      !('sourceEnvironmentVariable' in entry) ||
      typeof entry.sourceEnvironmentVariable !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.sourceEnvironmentVariable)
    )
      throw new Error('Invalid Sandbox credential grant');
    const key = JSON.stringify([entry.taskId, entry.environmentVariable]);
    if (seen.has(key)) throw new Error('Duplicate Sandbox credential grant');
    seen.add(key);
    return {
      agentId: entry.agentId,
      taskId: entry.taskId,
      environmentVariable: entry.environmentVariable,
      reference: entry.reference,
      sourceEnvironmentVariable: entry.sourceEnvironmentVariable,
    };
  });
}
export async function configuredSandboxCredentials(path: string | undefined) {
  if (path === undefined) return { grants: [], secrets: new EnvironmentSecretStore([]) };
  const file = Bun.file(path);
  if (file.size > 65536) throw new Error('Sandbox credential config too large');
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error('Cannot read Sandbox credential config');
  }
  const grants = parseSandboxCredentialGrants(value);
  const secrets = new EnvironmentSecretStore(
    grants.map((grant) => ({
      actorId: grant.agentId,
      reference: grant.reference,
      environmentVariable: grant.sourceEnvironmentVariable,
    })),
  );
  return { grants, secrets };
}
export async function runGrantedSandbox<T>(
  deps: {
    readonly tasks: Pick<TaskProvider, 'get'>;
    readonly agents: Pick<AgentRepository, 'list'>;
  },
  secrets: SecretStore,
  grants: readonly SandboxCredentialGrant[],
  taskId: string,
  input: SandboxInput,
  run: (input: SandboxInput, credentials: Readonly<Record<string, string>>) => Promise<T>,
): Promise<T> {
  const original = deps.tasks.get(taskId);
  const selected = grants.filter((grant) => grant.taskId === taskId).map((grant) => ({ ...grant }));
  const authorize = () => {
    const task = deps.tasks.get(taskId);
    const agent = deps.agents.list().find((candidate) => candidate.id === task.owner);
    if (
      !agent ||
      task.owner !== original.owner ||
      task.version !== original.version ||
      selected.some((grant) => grant.agentId !== task.owner)
    )
      throw new Error('Sandbox credential owner/version conflict');
    authorizeSandboxTask(task, agent, input, original.version);
  };
  authorize();
  const credentials: Record<string, string> = {};
  try {
    for (const grant of selected)
      credentials[grant.environmentVariable] = secrets.getSecret(grant.agentId, grant.reference);
  } catch {
    throw new Error('Sandbox credential unavailable');
  }
  authorize();
  const result = await run(input, credentials);
  authorize();
  return result;
}
