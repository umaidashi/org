import { isDeepStrictEqual } from 'node:util';
import { applyApprovedLinearComment } from './comment.js';
import { applyApprovedLinearArtifact } from './artifact.js';
import type { AgentRepository } from '../agents/port.js';
import type { SecretStore } from '../secrets/port.js';
import {
  mergeWorkItemSnapshot,
  parseProviderTaskPatch,
  validateTaskComment,
  validateTaskArtifact,
  validateTaskReferences,
  type Task,
  type TaskPatch,
  type WorkItem,
} from '../tasks/domain.js';
import type { AsyncTaskProvider, TaskProvider, WorkItemSynchronizer } from '../tasks/port.js';
import { validateLinearUpdatedIssueUrl } from '../approvals/domain.js';
import type { ApprovalStore } from '../approvals/port.js';
import type { EventBus } from '../events/port.js';
import { applyApprovedLinearUpdate, requestLinearUpdateApproval } from './update.js';
import { validateTaskWriteContext } from '../tasks/client.js';
import { linearWorkItemIssueId, syncLinearWorkItem } from './import.js';
import {
  readLinearCoreWorkItem,
  listLinearCoreWorkItems,
  parseLinearTaskMapping,
  linearCoreTaskPatch,
  type LinearTaskMapping,
} from './projection.js';
import { validateLinearIssueListInput } from './read.js';
export function validateLinearTaskScope(url: string | null, team: string): void {
  validateLinearIssueListInput({ team, limit: 50 });
  if (!url) throw new Error('Linear WorkItem reference required');
  validateLinearUpdatedIssueUrl({ issueUrl: url }, url);
  if (
    !new URL(url).pathname
      .split('/issue/')[1]
      ?.split('/')[0]
      ?.startsWith(team + '-')
  )
    throw new Error('Linear WorkItem outside Team scope');
}
export async function requestLinearCoreUpdateApproval(
  store: Pick<TaskProvider, 'get' | 'list'>,
  approvals: Pick<ApprovalStore, 'requestOnce'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  agents: Pick<AgentRepository, 'list'>,
  inputMapping: LinearTaskMapping,
  team: string,
  input: {
    readonly taskId: string;
    readonly patch: TaskPatch;
    readonly expectedVersion: number;
    readonly actor: string;
    readonly key: string;
  },
  identity: { readonly id: string; readonly createdAt: string },
) {
  validateTaskWriteContext(input);
  linearWorkItemIssueId(input.taskId);
  const mapping = parseLinearTaskMapping(inputMapping),
    patch = parseProviderTaskPatch(input.patch);
  const validate = () => {
    const task = store.get(input.taskId);
    if (task.kind !== 'work_item' || task.version !== input.expectedVersion)
      throw new Error('WorkItem version or kind conflict');
    const snapshot: WorkItem = { ...task, kind: 'work_item' };
    validateLinearTaskScope(task.externalRef, team);
    validateTaskReferences(
      mergeWorkItemSnapshot(task, snapshot, task.updatedAt, {
        ...(patch.parentId === undefined ? {} : { parentId: patch.parentId }),
        ...(patch.dependencies === undefined ? {} : { dependencies: patch.dependencies }),
      }),
      store.list(),
    );
    return linearCoreTaskPatch(agents, mapping, patch);
  };
  const fields = validate();
  const guarded = {
    getSecret: (actor: string, reference: string) => {
      validate();
      return secrets.getSecret(actor, reference);
    },
  };
  return await requestLinearUpdateApproval(
    store,
    approvals,
    guarded,
    request,
    {
      taskId: input.taskId,
      actor: input.actor,
      expectedVersion: input.expectedVersion,
      fields,
      key: input.key,
    },
    identity,
  );
}
export function linearTaskClient(
  store: Pick<TaskProvider, 'create' | 'get' | 'list' | 'artifacts'> & WorkItemSynchronizer,
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  agents: Pick<AgentRepository, 'list'>,
  inputMapping: LinearTaskMapping,
  team: string,
  now: () => string,
  writes: {
    readonly approvals: Pick<ApprovalStore, 'get'>;
    readonly events: Pick<EventBus, 'list' | 'publish'>;
  },
): AsyncTaskProvider {
  validateLinearIssueListInput({ team, limit: 50 });
  const mapping = parseLinearTaskMapping(inputMapping);
  const scope = (url: string | null) => validateLinearTaskScope(url, team);
  const reconcile = async (snapshot: WorkItem, original: Task | undefined): Promise<Task> => {
    scope(snapshot.externalRef);
    return original
      ? await syncLinearWorkItem(store, async () => snapshot, snapshot.id, original.version, now)
      : snapshot;
  };
  return {
    addComment: async (id, comment, context) => {
      validateTaskWriteContext(context);
      validateTaskComment(comment);
      linearWorkItemIssueId(id);
      const original = store.get(id);
      if (
        original.kind !== 'work_item' ||
        original.version !== context.expectedVersion ||
        context.actor !== comment.actor ||
        !context.approvalId
      )
        throw new Error('Invalid Linear comment context');
      scope(original.externalRef);
      const approval = writes.approvals.get(context.approvalId);
      if (
        approval.request.operation.kind !== 'linear_comment' ||
        approval.request.operation.commentId !== comment.id
      )
        throw new Error('Core comment ID does not match Approval');
      const guarded = {
        getSecret: (actor: string, reference: string) => {
          scope(store.get(id).externalRef);
          return secrets.getSecret(actor, reference);
        },
      };
      const receipt = await applyApprovedLinearComment(
        store,
        writes.approvals,
        writes.events,
        guarded,
        request,
        {
          taskId: id,
          actor: context.actor,
          expectedVersion: context.expectedVersion,
          approvalId: context.approvalId,
          body: comment.body,
        },
        now,
      );
      return { id: comment.id, reference: receipt.id };
    },
    linkArtifact: async (id, artifact, direction, context) => {
      validateTaskWriteContext(context);
      validateTaskArtifact(artifact);
      linearWorkItemIssueId(id);
      const original = store.get(id);
      if (
        original.kind !== 'work_item' ||
        original.version !== context.expectedVersion ||
        direction !== 'output' ||
        !context.approvalId ||
        !context.title
      )
        throw new Error('Invalid Linear artifact context');
      scope(original.externalRef);
      const check = () => {
        scope(store.get(id).externalRef);
        const saved = store.artifacts(id).find((value) => value.id === artifact.id);
        if (!saved || !isDeepStrictEqual(saved, artifact))
          throw new Error('Core artifact does not match staged original');
      };
      check();
      const guarded = {
        getSecret: (actor: string, reference: string) => {
          check();
          const key = secrets.getSecret(actor, reference);
          check();
          return key;
        },
      };
      const receipt = await applyApprovedLinearArtifact(
        store,
        writes.approvals,
        writes.events,
        guarded,
        request,
        {
          taskId: id,
          artifactId: artifact.id,
          title: context.title,
          actor: context.actor,
          expectedVersion: context.expectedVersion,
          approvalId: context.approvalId,
        },
        now,
      );
      return { task: original, reference: receipt.id };
    },
    update: async (id, input, context) => {
      validateTaskWriteContext(context);
      linearWorkItemIssueId(id);
      const patch = parseProviderTaskPatch(input),
        original = store.get(id);
      if (original.kind !== 'work_item' || original.version !== context.expectedVersion)
        throw new Error('WorkItem version or kind conflict');
      const snapshot: WorkItem = { ...original, kind: 'work_item' };
      scope(original.externalRef);
      const relations = {
        ...(patch.parentId === undefined ? {} : { parentId: patch.parentId }),
        ...(patch.dependencies === undefined ? {} : { dependencies: patch.dependencies }),
      };
      validateTaskReferences(
        mergeWorkItemSnapshot(original, snapshot, original.updatedAt, relations),
        store.list(),
      );
      const fields = linearCoreTaskPatch(agents, mapping, patch);
      if (!Object.keys(fields).length) {
        if (context.approvalId !== undefined)
          throw new Error('Local relations do not consume external Approval');
        return store.syncWorkItem(snapshot, context.expectedVersion, now(), relations);
      }
      if (!context.approvalId) throw new Error('Linear update requires Approval');
      const guarded = {
        getSecret: (actor: string, reference: string) => {
          linearCoreTaskPatch(agents, mapping, patch);
          scope(store.get(id).externalRef);
          return secrets.getSecret(actor, reference);
        },
      };
      const receipt = await applyApprovedLinearUpdate(
        store,
        writes.approvals,
        writes.events,
        guarded,
        request,
        {
          taskId: id,
          actor: context.actor,
          expectedVersion: context.expectedVersion,
          fields,
          approvalId: context.approvalId,
        },
        now,
      );
      try {
        return await syncLinearWorkItem(
          store,
          async () => {
            const snapshot = await readLinearCoreWorkItem(
              request,
              guarded,
              agents,
              mapping,
              linearWorkItemIssueId(id),
            );
            scope(snapshot.externalRef);
            for (const key of [
              'title',
              'objective',
              'status',
              'owner',
              'priority',
              'labels',
            ] as const) {
              const expected = patch[key];
              if (expected === undefined) continue;
              const actual = snapshot[key];
              if (
                !isDeepStrictEqual(
                  key === 'labels'
                    ? [...(patch.labels ?? [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
                    : expected,
                  actual,
                )
              )
                throw new Error('Linear Core update no longer matches requested fields');
            }
            return snapshot;
          },
          id,
          context.expectedVersion,
          now,
          relations,
        );
      } catch (error) {
        throw new Error(
          `Linear update confirmed by ${receipt.id}; Core synchronization failed; observe receipt and read Task without resending`,
          { cause: error },
        );
      }
    },
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
