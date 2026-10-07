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
export type MemoryPolicy = 'none' | 'reviewed-tasks';
export function validateMemoryPolicy(value: unknown): MemoryPolicy {
  if (value !== 'none' && value !== 'reviewed-tasks')
    throw new Error('Invalid Agent memory policy');
  return value;
}
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
export interface AgentPermissions {
  readonly rooms: readonly string[];
}
export function validatePermissions(value: unknown): AgentPermissions {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'rooms') ||
    !('rooms' in value) ||
    !Array.isArray(value.rooms) ||
    value.rooms.length > 128 ||
    new Set(value.rooms).size !== value.rooms.length
  )
    throw new Error('Invalid Agent permissions');
  const rooms = Array.from(value.rooms, (id: unknown) => {
    if (typeof id !== 'string' || !id || id.trim() !== id || id.includes('\0') || id.length > 128)
      throw new Error('Invalid Agent Room permission');
    return id;
  });
  return { rooms };
}
export function requireRoomPermission(agent: Agent, roomId: string): void {
  if (agent.permissions && !agent.permissions.rooms.includes(roomId))
    throw new Error('Agent Room permission required');
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly createdAt: string;
  readonly reportsTo?: string;
  readonly capabilities?: readonly Capability[];
  readonly memoryPolicy?: MemoryPolicy;
  readonly permissions?: AgentPermissions;
}

export interface AgentInput {
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly reportsTo?: string;
  readonly capabilities?: readonly string[];
  readonly memoryPolicy?: string;
  readonly permissions?: unknown;
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
  const { capabilities: grants, memoryPolicy: policy, permissions, ...fields } = input;
  return {
    ...fields,
    ...identity,
    ...(grants === undefined ? {} : { capabilities: validateCapabilities(grants) }),
    ...(policy === undefined ? {} : { memoryPolicy: validateMemoryPolicy(policy) }),
    ...(permissions === undefined ? {} : { permissions: validatePermissions(permissions) }),
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
