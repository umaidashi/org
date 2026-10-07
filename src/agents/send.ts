import type { AgentRepository } from './port.js';
import type { RoomRepository } from '../rooms/port.js';
import { createMessage, type Identity } from '../rooms/domain.js';

export interface AgentSendInput {
  readonly agentId: string;
  readonly roomId: string;
  readonly humanId: string;
  readonly content: string;
}

export function sendAgentMessage(
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get' | 'append'>,
  input: AgentSendInput,
  identity: Identity,
) {
  if (!agents.list().some((agent) => agent.id === input.agentId))
    throw new Error('Agent send target not found');
  const room = rooms.get(input.roomId);
  if (room.id !== input.roomId) throw new Error('Agent send Room mismatch');
  const messageInput = {
    sender: { kind: 'human' as const, id: input.humanId },
    content: input.content,
    metadata: { mentions: [input.agentId] },
  };
  createMessage(room, messageInput, identity);
  return rooms.append(room.id, messageInput, identity);
}
