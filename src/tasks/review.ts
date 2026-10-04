import type { Task } from './domain.js';
export interface TaskReviewInput {
  readonly decision: 'approve' | 'reject';
  readonly actor: string;
  readonly reason: string;
  readonly expectedVersion: number;
}
export interface TaskReview {
  readonly id: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly outputArtifacts: readonly string[];
  readonly decision: 'approve' | 'reject';
  readonly actor: string;
  readonly reason: string;
  readonly createdAt: string;
}
export interface TaskReviewWriter {
  get(id: string): Task;
  recordReview(review: TaskReview): Task;
}
export function planTaskReview(
  task: Task,
  input: TaskReviewInput,
  identity: { readonly id: string; readonly createdAt: string },
): TaskReview {
  if (
    task.kind !== 'execution_task' ||
    task.status !== 'waiting_approval' ||
    !task.outputArtifacts.length
  )
    throw new Error('Result review requires an ExecutionTask with results awaiting approval');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== task.version)
    throw new Error('Task review version conflict');
  for (const value of [input.actor, input.reason, identity.id, identity.createdAt])
    if (!value.trim()) throw new Error('Review fields must not be empty');
  if (input.decision !== 'approve' && input.decision !== 'reject')
    throw new Error('Invalid review decision');
  return {
    ...identity,
    taskId: task.id,
    taskVersion: task.version,
    outputArtifacts: [...task.outputArtifacts],
    decision: input.decision,
    actor: input.actor,
    reason: input.reason,
  };
}
export function reviewTaskResult(
  writer: TaskReviewWriter,
  taskId: string,
  input: TaskReviewInput,
  identity: { readonly id: string; readonly createdAt: string },
): Task {
  return writer.recordReview(planTaskReview(writer.get(taskId), input, identity));
}
