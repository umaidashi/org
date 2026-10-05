import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { SessionStore, SessionRebuilder } from './port.js';
import { createSession, decodeSession } from './domain.js';
import { sessionAgent } from './service.js';
export function rebuildSessionForAgent(
  store: Pick<SessionStore, 'get'> & SessionRebuilder,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get'>,
  input: { readonly id: string; readonly expectedVersion: number },
  identity: { readonly id: string; readonly at: string },
) {
  const original = store.get(input.id);
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    original.version !== input.expectedVersion
  )
    throw new Error('Stale Session version');
  if (original.status !== 'failed') throw new Error('Session reconstruction requires failed state');
  const agent = sessionAgent(agents, rooms, original.agentId, original.roomId);
  if (agent.runtime !== 'claude' && agent.runtime !== 'codex')
    throw new Error('Unsupported Session runtime');
  const next = decodeSession({
    ...createSession(
      { agentId: original.agentId, roomId: original.roomId, runtime: agent.runtime },
      identity,
    ),
    rebuiltFrom: { sessionId: original.id, version: original.version },
  });
  return store.rebuildSession(original.id, original.version, next);
}
