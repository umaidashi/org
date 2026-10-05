export const capabilities = [
  'can_read',
  'can_write',
  'can_delegate',
  'can_approve',
  'can_spend',
  'can_publish',
  'can_contact_external',
  'can_run_shell',
  'can_access_network',
] as const;
export type Capability = (typeof capabilities)[number];
export function validateCapabilities(value: unknown): readonly Capability[] {
  if (
    !Array.isArray(value) ||
    Array.from(value).some(
      (item: unknown) =>
        typeof item !== 'string' || !capabilities.some((capability) => capability === item),
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid Agent capabilities');
  return value.map((item: unknown) => {
    const capability = capabilities.find((candidate) => candidate === item);
    if (capability === undefined) throw new Error('Invalid Agent capability');
    return capability;
  });
}
export function requireCapability(agent: Agent, capability: Capability): void {
  if (!agent.capabilities?.includes(capability))
    throw new Error(`Agent capability required: ${capability}`);
}
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly createdAt: string;
  readonly reportsTo?: string;
  readonly capabilities?: readonly Capability[];
}

export interface AgentInput {
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly reportsTo?: string;
  readonly capabilities?: readonly string[];
}

export interface Identity {
  readonly id: string;
  readonly createdAt: string;
}

export function createAgent(input: AgentInput, identity: Identity): Agent {
  for (const field of ['name', 'role', 'runtime'] as const) {
    if (!input[field].trim()) throw new Error(`Agent ${field} must not be empty`);
  }
  if (input.reportsTo !== undefined && (!input.reportsTo.trim() || input.reportsTo === identity.id))
    throw new Error('Agent reportsTo must name another Agent');
  const { capabilities: grants, ...fields } = input;
  return {
    ...fields,
    ...identity,
    ...(grants === undefined ? {} : { capabilities: validateCapabilities(grants) }),
  };
}

export function changeReportingLine(
  agents: readonly Agent[],
  id: string,
  manager: string | null,
): Agent {
  const agent = agents.find((candidate) => candidate.id === id);
  if (!agent) throw new Error('Agent not found');
  const changed = { ...agent };
  if (manager === null) {
    delete changed.reportsTo;
    return changed;
  }
  const visited = new Set<string>();
  let cursor: string | undefined = manager;
  while (cursor !== undefined) {
    if (cursor === id || visited.has(cursor)) throw new Error('Agent reporting cycle');
    visited.add(cursor);
    const parent = agents.find((candidate) => candidate.id === cursor);
    if (!parent) throw new Error('Manager Agent not found');
    cursor = parent.reportsTo;
  }
  return { ...changed, reportsTo: manager };
}
