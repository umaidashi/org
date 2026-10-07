import type { AgentRepository } from '../agents/port.js';
import type { SecretStore } from '../secrets/port.js';
import { mergeWorkItemSnapshot, type Task, type WorkItem } from '../tasks/domain.js';
import type { AsyncTaskProvider, TaskProvider, WorkItemSynchronizer } from '../tasks/port.js';
import { validateLinearUpdatedIssueUrl } from '../approvals/domain.js';
import { linearWorkItemIssueId, syncLinearWorkItem } from './import.js';
import {
  readLinearCoreWorkItem,
  listLinearCoreWorkItems,
  parseLinearTaskMapping,
  type LinearTaskMapping,
} from './projection.js';
import { validateLinearIssueListInput } from './read.js';
export function linearTaskClient(
  store: Pick<TaskProvider, 'create' | 'get' | 'list'> & WorkItemSynchronizer,
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  agents: Pick<AgentRepository, 'list'>,
  inputMapping: LinearTaskMapping,
  team: string,
  now: () => string,
): AsyncTaskProvider {
  validateLinearIssueListInput({ team, limit: 50 });
  const mapping = parseLinearTaskMapping(inputMapping);
  const scope = (url: string | null) => {
    if (!url) throw new Error('Linear WorkItem reference required');
    validateLinearUpdatedIssueUrl({ issueUrl: url }, url);
    if (
      !new URL(url).pathname
        .split('/issue/')[1]
        ?.split('/')[0]
        ?.startsWith(team + '-')
    )
      throw new Error('Linear WorkItem outside Team scope');
  };
  const reconcile = async (snapshot: WorkItem, original: Task | undefined): Promise<Task> => {
    scope(snapshot.externalRef);
    return original
      ? await syncLinearWorkItem(store, async () => snapshot, snapshot.id, original.version, now)
      : snapshot;
  };
  return {
    create: async (task) => {
      const issueId = linearWorkItemIssueId(task.id);
      scope(task.externalRef);
      if (task.kind !== 'work_item' || task.version !== 0)
        throw new Error('Linear create requires a new WorkItem mirror');
      if (store.list().some((existing) => existing.id === task.id))
        throw new Error('Task already exists');
      const snapshot = await readLinearCoreWorkItem(request, secrets, agents, mapping, issueId);
      scope(snapshot.externalRef);
      validateLinearUpdatedIssueUrl({ issueUrl: task.externalRef ?? '' }, snapshot.externalRef);
      const created = {
        ...mergeWorkItemSnapshot(
          task,
          { ...snapshot, externalRef: task.externalRef },
          task.createdAt,
        ),
        version: 0,
      };
      store.create(created);
      return store.get(created.id);
    },
    get: async (id) => {
      const issueId = linearWorkItemIssueId(id);
      const original = store.list().find((task) => task.id === id);
      if (original) {
        scope(original.externalRef);
        return await syncLinearWorkItem(
          store,
          async () => {
            const snapshot = await readLinearCoreWorkItem(
              request,
              secrets,
              agents,
              mapping,
              issueId,
            );
            scope(snapshot.externalRef);
            return snapshot;
          },
          id,
          original.version,
          now,
        );
      }
      return await reconcile(
        await readLinearCoreWorkItem(request, secrets, agents, mapping, issueId),
        undefined,
      );
    },
    list: async (filter = {}) => {
      if (filter.kind === 'execution_task') return [];
      const original = new Map(store.list().map((task) => [task.id, task]));
      const snapshots: WorkItem[] = [],
        ids = new Set<string>(),
        cursors = new Set<string>();
      let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await listLinearCoreWorkItems(request, secrets, agents, mapping, {
          team,
          limit: 50,
          ...(after === undefined ? {} : { after }),
        });
        for (const task of result.nodes) {
          scope(task.externalRef);
          if (ids.has(task.id)) throw new Error('Duplicate Linear WorkItem across pages');
          ids.add(task.id);
          snapshots.push(task);
        }
        if (!result.pageInfo.hasNextPage) {
          const tasks: Task[] = [];
          for (const snapshot of snapshots)
            tasks.push(await reconcile(snapshot, original.get(snapshot.id)));
          return tasks.filter(
            (task) =>
              (filter.status === undefined || task.status === filter.status) &&
              (filter.owner === undefined || task.owner === filter.owner),
          );
        }
        const cursor = result.pageInfo.endCursor;
        if (cursor === null || cursors.has(cursor)) throw new Error('Repeated Linear cursor');
        cursors.add(cursor);
        after = cursor;
      }
      throw new Error('Linear list exceeds 500 WorkItems or 10 pages');
    },
  };
}
