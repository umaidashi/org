import type { Task, TaskKind, TaskPatch, TaskStatus, TaskComment, TaskArtifact } from './domain.js';
export interface IdempotentTaskWriter {
  createAssignedOnce(task: Task, owner: string, at: string): Task;
}
export interface TaskFilter {
  readonly kind?: TaskKind;
  readonly status?: TaskStatus;
  readonly owner?: string;
}
export interface TaskHistory {
  readonly version: number;
  readonly status: TaskStatus;
  readonly at: string;
  readonly task: Task;
}
export interface TaskProvider {
  create(task: Task): void;
  get(id: string): Task;
  update(id: string, patch: TaskPatch, at: string, expectedVersion?: number): Task;
  list(filter?: TaskFilter): readonly Task[];
  history(id: string): readonly TaskHistory[];
  addComment(id: string, comment: TaskComment): void;
  comments(id: string): readonly TaskComment[];
  linkArtifact(id: string, artifact: TaskArtifact, direction: 'input' | 'output'): Task;
  artifacts(id: string): readonly TaskArtifact[];
}

export interface ExecutionResultWriter {
  stageExecutionResult(id: string, artifact: TaskArtifact, expectedVersion: number): Task;
}
