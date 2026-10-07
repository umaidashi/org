import { requireCapability } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { SecretStore } from '../secrets/port.js';
import { readLinearIssue, validateLinearIssueId } from './read.js';

export interface LinearAgentScope {
  readonly agentId: string;
  readonly issueIds: readonly string[];
  readonly apiKeyEnv: string;
  readonly effect?: 'write';
}
export function parseLinearAgentScopes(value: unknown): readonly LinearAgentScope[] {
  if (!Array.isArray(value)) throw new Error('Invalid Agent Linear scopes');
  const seen = new Set<string>();
  return Array.from(value, (scope: unknown) => {
    if (
      !scope ||
      typeof scope !== 'object' ||
      Array.isArray(scope) ||
      Object.keys(scope).some(
        (key) => !['agentId', 'issueIds', 'apiKeyEnv', 'effect'].includes(key),
      ) ||
      ('effect' in scope && scope.effect !== 'write') ||
      !('agentId' in scope) ||
      typeof scope.agentId !== 'string' ||
      !scope.agentId.trim() ||
      scope.agentId.length > 128 ||
      scope.agentId.includes('\0') ||
      !('issueIds' in scope) ||
      !Array.isArray(scope.issueIds) ||
      !('apiKeyEnv' in scope) ||
      typeof scope.apiKeyEnv !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(scope.apiKeyEnv)
    )
      throw new Error('Invalid Agent Linear scope');
    if (seen.has(scope.agentId)) throw new Error('Duplicate Agent Linear scope');
    seen.add(scope.agentId);
    const issueIds = Array.from(scope.issueIds, (id: unknown) => {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || validateLinearIssueId(id) !== id)
        throw new Error('Agent Linear scope requires canonical Issue UUID');
      return id;
    });
    if (new Set(issueIds).size !== issueIds.length)
      throw new Error('Duplicate scoped Linear Issue');
    return {
      agentId: scope.agentId,
      issueIds,
      apiKeyEnv: scope.apiKeyEnv,
      ...('effect' in scope ? { effect: 'write' as const } : {}),
    };
  });
}
export function requireAgentLinearScope(
  agents: Pick<AgentRepository, 'list'>,
  scopes: readonly LinearAgentScope[],
  input: { readonly agentId: string; readonly issueId: string; readonly effect?: 'write' },
): void {
  const agent = agents.list().find((a) => a.id === input.agentId);
  if (!agent) throw new Error('Agent not found');
  if (
    !scopes.some(
      (scope) =>
        scope.agentId === input.agentId &&
        scope.issueIds.includes(input.issueId) &&
        (input.effect === undefined || scope.effect === 'write'),
    )
  )
    throw new Error('Agent Linear Issue access denied');
  for (const capability of ['can_read', 'can_access_network', 'can_contact_external'] as const)
    requireCapability(agent, capability);
  if (input.effect === 'write') requireCapability(agent, 'can_write');
}
export async function readAgentLinearIssue(
  agents: Pick<AgentRepository, 'list'>,
  scopes: readonly LinearAgentScope[],
  secrets: Pick<SecretStore, 'getSecret'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  input: { readonly agentId: string; readonly issueId: string },
) {
  const agentId = input.agentId,
    issueId = input.issueId;
  const configured = parseLinearAgentScopes(scopes);
  const authorize = () => requireAgentLinearScope(agents, configured, { agentId, issueId });
  authorize();
  const issue = await readLinearIssue(
    request,
    {
      getSecret: (actor, reference) => {
        if (actor !== 'linear:host' || reference !== 'linear:read')
          throw new Error('Secret access denied');
        authorize();
        return secrets.getSecret(agentId, 'linear:read');
      },
    },
    issueId,
  );
  authorize();
  return issue;
}
