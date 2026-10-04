import type { AgentRepository } from '../agents/port.js';
import type { TaskProvider } from '../tasks/port.js';
import { createRoom } from './domain.js';
import type { Identity, Room, RoomInput } from './domain.js';
import type { RoomRepository } from './port.js';

export function registerRoom(
  repository: Pick<RoomRepository, 'create'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: Pick<TaskProvider, 'get'>,
  input: RoomInput,
  identity: Identity,
): Room {
  const room = createRoom(input, identity);
  const known = new Set(agents.list().map((agent) => agent.id));
  for (const participant of room.participants) {
    if (participant.kind === 'agent' && !known.has(participant.id))
      throw new Error('Room Agent not found');
  }
  if (room.taskId !== null) tasks.get(room.taskId);
  return repository.create(room);
}
