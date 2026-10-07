import { createTask } from '../tasks/domain.js';
import type { Task } from '../tasks/domain.js';
import type { TaskProvider, WorkItemImporter } from '../tasks/port.js';
import { validateLinearIssueId } from './read.js';
import { validateLinearUpdatedIssueUrl } from '../approvals/domain.js';
import type { readLinearIssue } from './read.js';
export async function importLinearWorkItem(
  writer: WorkItemImporter,
  read: () => ReturnType<typeof readLinearIssue>,
  at: string,
): Promise<Task> {
  const issue = await read();
  // ponytail: initial snapshot only; add explicit versioned sync when remote edits must update local work.
  const task = {
    ...createTask(
      {
        title: issue.title,
        objective: `Linear source: ${issue.url}\n\n${issue.description ?? issue.title}`,
        labels: [issue.identifier],
      },
      { id: `linear:issue:${issue.id}`, createdAt: at },
    ),
    externalRef: issue.url,
  };
  return writer.importWorkItemOnce(task);
}

export function linearWorkItemIssueId(taskId: string): string {
  if (!/^linear:issue:[0-9a-f-]{36}$/.test(taskId)) throw new Error('Invalid Linear WorkItem ID');
  return validateLinearIssueId(taskId.slice('linear:issue:'.length));
}

export async function refreshLinearWorkItem(
  provider: Pick<TaskProvider, 'get' | 'update'>,
  read: () => ReturnType<typeof readLinearIssue>,
  taskId: string,
  expectedVersion: number,
  at: string,
): Promise<Task> {
  const issueId = linearWorkItemIssueId(taskId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
    throw new Error('Invalid expected version');
  const original = provider.get(taskId);
  if (original.id !== taskId || original.kind !== 'work_item' || !original.externalRef)
    throw new Error('Refresh requires an imported WorkItem');
  if (original.version !== expectedVersion) throw new Error('WorkItem version conflict');
  const issue = await read();
  if (issue.id !== issueId) throw new Error('Linear WorkItem identity conflict');
  try {
    validateLinearUpdatedIssueUrl({ issueUrl: original.externalRef }, issue.url);
  } catch {
    throw new Error('Linear WorkItem identity conflict');
  }
  const current = provider.get(taskId);
  if (current.version !== expectedVersion) throw new Error('WorkItem version conflict');
  const objective = `Linear source: ${issue.url}\n\n${issue.description ?? issue.title}`;
  if (current.title === issue.title && current.objective === objective) return current;
  return provider.update(taskId, { title: issue.title, objective }, at, expectedVersion);
}
