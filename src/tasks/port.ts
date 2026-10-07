import type { AuditActor, AuditEntry } from '../audit/domain.js';
import type {
  Task,
  TaskKind,
  TaskPatch,
  TaskStatus,
  TaskComment,
  TaskArtifact,
  WorkItem,
} from './domain.js';
export interface IdempotentTaskWriter {
  createAssignedOnce(task: Task, owner: string, at: string, context?: TaskOperationContext): Task;
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
  addComment(id: string, comment: TaskComment, expectedVersion?: number): void;
  comments(id: string): readonly TaskComment[];
  linkArtifact(
    id: string,
    artifact: TaskArtifact,
    direction: 'input' | 'output',
    expectedVersion?: number,
  ): Task;
  artifacts(id: string): readonly TaskArtifact[];
}
export interface AsyncTaskProvider {
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task>;
  list(filter?: TaskFilter): Promise<readonly Task[]>;
  update(id: string, patch: TaskPatch, context: TaskWriteContext): Promise<Task>;
  addComment(
    id: string,
    comment: TaskComment,
    context: TaskWriteContext,
  ): Promise<{ readonly id: string; readonly reference: string | null }>;
  linkArtifact(
    id: string,
    artifact: TaskArtifact,
    direction: 'input' | 'output',
    context: TaskWriteContext & { readonly title?: string },
  ): Promise<{ readonly task: Task; readonly reference: string | null }>;
}
export interface TaskWriteContext {
  readonly actor: string;
  readonly expectedVersion: number;
  readonly approvalId?: string;
}

export interface ExecutionResultWriter {
  stageExecutionResult(id: string, artifact: TaskArtifact, expectedVersion: number): Task;
}

export interface WorkItemImporter {
  importWorkItemOnce(task: Task): Task;
}
export interface WorkItemSynchronizer {
  get(id: string): Task;
  syncWorkItem(
    snapshot: WorkItem,
    expectedVersion: number,
    at: string,
    relations?: Pick<TaskPatch, 'parentId' | 'dependencies'>,
  ): Task;
}

export interface TaskOperationContext {
  readonly actor?: AuditActor;
  readonly eventId?: string;
}
export interface TaskOperationReader {
  operationHistory(): readonly AuditEntry[];
}
