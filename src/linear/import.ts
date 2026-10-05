import { createTask } from '../tasks/domain.js';
import type { Task } from '../tasks/domain.js';
import type { WorkItemImporter } from '../tasks/port.js';
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
