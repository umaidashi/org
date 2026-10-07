import { readFileSync } from 'node:fs';
import { parseLinearAgentScopes } from './agent-read.js';
import { parseLinearTaskMapping } from './projection.js';
export function linearTaskMapping() {
  let value: unknown;
  try {
    const path = process.env.ORG_LINEAR_TASK_MAPPING;
    if (!path) throw new Error('Missing mapping configuration');
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Linear Task mapping unavailable');
  }
  return parseLinearTaskMapping(value);
}

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
