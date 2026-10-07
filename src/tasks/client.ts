import { parseProviderTaskPatch, type Task, type TaskPatch } from './domain.js';
import type { AsyncTaskProvider, TaskProvider, TaskFilter, TaskWriteContext } from './port.js';
export type TaskClientAction =
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
  store: Pick<TaskProvider, 'create' | 'get' | 'list' | 'update'>,
  now: () => string,
): AsyncTaskProvider {
  return {
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
