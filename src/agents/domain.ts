export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly createdAt: string;
  readonly reportsTo?: string;
}

export interface AgentInput {
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly reportsTo?: string;
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
  return { ...input, ...identity };
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
