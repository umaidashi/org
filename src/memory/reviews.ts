import type { AgentRepository } from '../agents/port.js';
import type { TaskProvider } from '../tasks/port.js';
import { verifiedTaskReview, type TaskReviewReader } from '../tasks/review.js';
import { createMemory } from './domain.js';
import type { MemoryProvider } from './port.js';

export function projectReviewedTaskMemories(
  memories: Pick<MemoryProvider, 'createOnce'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: Pick<TaskProvider, 'list' | 'history'> & TaskReviewReader,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) return;
  const policies = new Map(agents.list().map((agent) => [agent.id, agent.memoryPolicy]));
  if (![...policies.values()].includes('reviewed-tasks')) return;
  // ponytail: scan Task reviews; use a persisted cursor if polling cost becomes measurable.
  for (const task of tasks.list({ kind: 'execution_task' })) {
    if (signal?.aborted) return;
    const reviews = tasks.reviews(task.id).filter((review) => review.decision === 'approve');
    if (!reviews.length) continue;
    const history = tasks.history(task.id);
    for (const review of reviews) {
      if (signal?.aborted) return;
      const { before, after } = verifiedTaskReview(history, review);
      if (before.id !== task.id) throw new Error('Task review evidence conflict');
      if (before.owner === null || policies.get(before.owner) !== 'reviewed-tasks') continue;
      const source = `org://tasks/${encodeURIComponent(task.id)}/reviews/${encodeURIComponent(review.id)}`;
      memories.createOnce(
        createMemory(
          {
            type: 'episodic',
            scope: `task:${task.id}`,
            confidence: 1,
            content: JSON.stringify({
              kind: 'task_review',
              taskId: task.id,
              title: before.title,
              objective: before.objective,
              taskRef: `org://tasks/${encodeURIComponent(task.id)}/versions/${after.version}`,
              review,
            }),
            sourceRefs: [{ uri: source }],
          },
          {
            id: `memory:task-review:${encodeURIComponent(task.id)}:${encodeURIComponent(review.id)}`,
            at: review.createdAt,
          },
        ),
      );
    }
  }
}
