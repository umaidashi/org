import type { RoomRepository } from '../rooms/port.js';
import { createMemory } from './domain.js';
import type { Memory, MemoryInput } from './domain.js';
import type { MemoryProvider } from './port.js';
export function captureMemory(
  provider: Pick<MemoryProvider, 'create'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  input: MemoryInput,
  identity: { readonly id: string; readonly at: string },
): Memory {
  const memory = createMemory(input, identity);
  for (const ref of memory.sourceRefs) {
    rooms.get(ref.roomId);
    if (!rooms.messages(ref.roomId).some((m) => m.id === ref.messageId && m.roomId === ref.roomId))
      throw new Error('Memory source Message not found');
  }
  return provider.create(memory);
}
