import { requireCapability } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { RuntimeTurnInput, RuntimeTurnResult } from '../runtime/port.js';
import { createSession, transitionSession } from './domain.js';
import type { Session } from './domain.js';
import type { SessionStore } from './port.js';
export function sessionAgent(
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get'>,
  agentId: string,
  roomId: string,
) {
  const agent = agents.list().find((agent) => agent.id === agentId);
  if (!agent) throw new Error('Session Agent not found');
  requireCapability(agent, 'can_read');
  if (agent.runtime !== 'codex' && agent.runtime !== 'claude')
    throw new Error('Unsupported Session runtime');
  const room = rooms.get(roomId);
  if (room.archivedAt !== null) throw new Error('Session Room is archived');
  if (
    !room.participants.some(
      (participant) => participant.kind === 'agent' && participant.id === agentId,
    )
  )
    throw new Error('Session Agent is not a Room participant');
  return agent;
}
export function createSessionForAgent(
  store: Pick<SessionStore, 'create'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get'>,
  input: { readonly agentId: string; readonly roomId: string },
  identity: { readonly id: string; readonly at: string },
): Session {
  const agent = sessionAgent(agents, rooms, input.agentId, input.roomId);
  if (agent.runtime !== 'codex' && agent.runtime !== 'claude')
    throw new Error('Unsupported Session runtime');
  const session = createSession({ ...input, runtime: agent.runtime }, identity);
  store.create(session);
  return session;
}
export async function sendSession(
  store: Pick<SessionStore, 'get' | 'save'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get'>,
  run: (input: RuntimeTurnInput, signal?: AbortSignal) => Promise<RuntimeTurnResult>,
  input: { readonly id: string; readonly message: string; readonly instruction: string },
  now: () => string,
  signal?: AbortSignal,
): Promise<{ readonly session: Session; readonly text: string }> {
  if (!input.message.trim()) throw new Error('Session message required');
  const initial = store.get(input.id);
  const agent = sessionAgent(agents, rooms, initial.agentId, initial.roomId);
  if (agent.runtime !== initial.runtime) throw new Error('Session runtime changed');
  const running = transitionSession(initial, { type: 'begin', at: now() });
  store.save(running, initial.version);
  try {
    const reply = await run(
      {
        agent: { id: agent.id, role: agent.role },
        message: input.message,
        instruction: input.instruction,
        ...(running.providerSessionId === null ? {} : { sessionId: running.providerSessionId }),
      },
      signal,
    );
    const currentAgent = sessionAgent(agents, rooms, running.agentId, running.roomId);
    if (currentAgent.runtime !== running.runtime) throw new Error('Session runtime changed');
    const completed = transitionSession(running, {
      type: 'complete',
      providerSessionId: reply.sessionId,
      at: now(),
    });
    store.save(completed, running.version);
    return { session: completed, text: reply.text };
  } catch (error) {
    try {
      const current = store.get(running.id);
      if (current.version === running.version && current.status === 'running')
        store.save(
          transitionSession(current, { type: 'fail', error: 'Runtime turn failed', at: now() }),
          current.version,
        );
    } catch (persistence) {
      throw new AggregateError([error, persistence], 'Runtime turn and failure persistence failed');
    }
    throw error;
  }
}
export function stopSession(
  store: Pick<SessionStore, 'get' | 'save'>,
  id: string,
  at: string,
  cancel: (id: string) => void,
): Session {
  const current = store.get(id);
  if (current.status === 'stopped') {
    cancel(id);
    return current;
  }
  const stopped = transitionSession(current, { type: 'stop', at });
  store.save(stopped, current.version);
  cancel(id);
  return stopped;
}
export function recoverSessions(
  store: Pick<SessionStore, 'list' | 'save'>,
  at: string,
): readonly Session[] {
  const recovered: Session[] = [];
  for (const session of store.list()) {
    if (session.status !== 'running') continue;
    const failed = transitionSession(session, {
      type: 'fail',
      error: 'Runtime interrupted by daemon restart',
      at,
    });
    store.save(failed, session.version);
    recovered.push(failed);
  }
  return recovered;
}
