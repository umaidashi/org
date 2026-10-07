import { readFileSync } from 'node:fs';
import { parseLinearAgentScopes } from './agent-read.js';

export function linearAgentScopes() {
  let value: unknown;
  try {
    const path = process.env.ORG_LINEAR_AGENT_SCOPES;
    if (!path) throw new Error('Missing scope configuration');
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Agent Linear scope configuration unavailable');
  }
  return parseLinearAgentScopes(value);
}
