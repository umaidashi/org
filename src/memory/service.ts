import type { RoomRepository } from '../rooms/port.js';
import { createMemory, taskReviewSource } from './domain.js';
import type { Memory, MemoryInput } from './domain.js';
import type { MemoryProvider } from './port.js';
import type { TaskProvider } from '../tasks/port.js';
import type { TaskReviewReader } from '../tasks/review.js';
export function captureMemory(
  provider: Pick<MemoryProvider, 'create'>,
  rooms: Pick<RoomRepository, 'get' | 'messages'> | undefined,
  input: MemoryInput,
  identity: { readonly id: string; readonly at: string },
  tasks?: Pick<TaskProvider, 'get'> & TaskReviewReader,
): Memory {
  const memory = createMemory(input, identity);
  for (const ref of memory.sourceRefs) {
    if ('uri' in ref) {
      if (!tasks) throw new Error('Memory TaskReview reader required');
      const { taskId, reviewId } = taskReviewSource(ref.uri);
      if (
        tasks.get(taskId).id !== taskId ||
        !tasks.reviews(taskId).some((review) => review.id === reviewId && review.taskId === taskId)
      )
        throw new Error('Memory source TaskReview not found');
      continue;
    }
    if (!rooms) throw new Error('Memory Message reader required');
    rooms.get(ref.roomId);
    if (!rooms.messages(ref.roomId).some((m) => m.id === ref.messageId && m.roomId === ref.roomId))
      throw new Error('Memory source Message not found');
  }
  return provider.create(memory);
}
