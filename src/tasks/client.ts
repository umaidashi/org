import type { Task } from './domain.js';
import type { AsyncTaskProvider, TaskProvider, TaskFilter } from './port.js';
export type TaskClientAction =
  | { readonly kind: 'create'; readonly task: Task }
  | { readonly kind: 'get'; readonly id: string }
  | { readonly kind: 'list'; readonly filter: TaskFilter };
export async function runTaskClient(provider: AsyncTaskProvider, action: TaskClientAction) {
  switch (action.kind) {
    case 'create':
      return await provider.create(action.task);
    case 'get':
      return await provider.get(action.id);
    case 'list':
      return await provider.list(action.filter);
  }
}
export function localTaskClient(
  store: Pick<TaskProvider, 'create' | 'get' | 'list'>,
): AsyncTaskProvider {
  return {
    create: async (task) => {
      store.create(task);
      return store.get(task.id);
    },
    get: async (id) => store.get(id),
    list: async (filter) => store.list(filter),
  };
}
