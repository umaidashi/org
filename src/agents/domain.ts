export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
  readonly createdAt: string;
}

export interface AgentInput {
  readonly name: string;
  readonly role: string;
  readonly runtime: string;
}

export interface Identity {
  readonly id: string;
  readonly createdAt: string;
}

export function createAgent(input: AgentInput, identity: Identity): Agent {
  for (const field of ['name', 'role', 'runtime'] as const) {
    if (!input[field].trim()) throw new Error(`Agent ${field} must not be empty`);
  }
  return { ...input, ...identity };
}
