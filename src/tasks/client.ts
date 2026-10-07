import {
  parseProviderTaskPatch,
  validateTaskComment,
  validateTaskArtifact,
  type TaskComment,
  type TaskArtifact,
  type Task,
  type TaskPatch,
} from './domain.js';
import type { AsyncTaskProvider, TaskProvider, TaskFilter, TaskWriteContext } from './port.js';
export type TaskClientAction =
  | {
      readonly kind: 'comment';
      readonly id: string;
      readonly comment: TaskComment;
      readonly context: TaskWriteContext;
    }
  | {
      readonly kind: 'artifact';
      readonly id: string;
      readonly artifact: TaskArtifact;
      readonly direction: 'input' | 'output';
      readonly context: TaskWriteContext & { readonly title?: string };
    }
  | { readonly kind: 'create'; readonly task: Task }
  | { readonly kind: 'get'; readonly id: string }
  | { readonly kind: 'list'; readonly filter: TaskFilter }
  | {
      readonly kind: 'update';
      readonly id: string;
      readonly patch: TaskPatch;
      readonly context: TaskWriteContext;
    };
export function validateTaskWriteContext(context: TaskWriteContext): void {
  if (
    typeof context.actor !== 'string' ||
    !context.actor.trim() ||
    context.actor.includes('\0') ||
    context.actor.length > 128 ||
    !Number.isSafeInteger(context.expectedVersion) ||
    context.expectedVersion < 0 ||
    (context.approvalId !== undefined &&
      (typeof context.approvalId !== 'string' ||
        !context.approvalId.trim() ||
        context.approvalId.includes('\0')))
  )
    throw new Error('Invalid Task write context');
}
export async function runTaskClient(provider: AsyncTaskProvider, action: TaskClientAction) {
  switch (action.kind) {
    case 'comment':
      return await provider.addComment(action.id, action.comment, action.context);
    case 'artifact':
      return await provider.linkArtifact(
        action.id,
        action.artifact,
        action.direction,
        action.context,
      );
    case 'create':
      return await provider.create(action.task);
    case 'get':
      return await provider.get(action.id);
    case 'list':
      return await provider.list(action.filter);
    case 'update':
      return await provider.update(action.id, action.patch, action.context);
  }
}
export function localTaskClient(
  store: Pick<TaskProvider, 'create' | 'get' | 'list' | 'update' | 'addComment' | 'linkArtifact'>,
  now: () => string,
): AsyncTaskProvider {
  return {
    addComment: async (id, comment, context) => {
      validateTaskWriteContext(context);
      validateTaskComment(comment);
      if (context.approvalId !== undefined || context.actor !== comment.actor)
        throw new Error('Invalid Local comment authorization');
      store.addComment(id, comment, context.expectedVersion);
      return { id: comment.id, reference: null };
    },
    linkArtifact: async (id, artifact, direction, context) => {
      validateTaskWriteContext(context);
      validateTaskArtifact(artifact);
      if (
        !['input', 'output'].includes(direction) ||
        context.approvalId !== undefined ||
        context.title !== undefined
      )
        throw new Error('Invalid Local artifact authorization');
      return {
        task: store.linkArtifact(id, artifact, direction, context.expectedVersion),
        reference: null,
      };
    },
    create: async (task) => {
      store.create(task);
      return store.get(task.id);
    },
    get: async (id) => store.get(id),
    list: async (filter) => store.list(filter),
    update: async (id, patch, context) => {
      validateTaskWriteContext(context);
      if (context.approvalId !== undefined)
        throw new Error('Local update does not consume external Approval');
      return store.update(id, parseProviderTaskPatch(patch), now(), context.expectedVersion);
    },
  };
}
