import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { importLinearWorkItem } from '../src/linear/import.js';
const issue = {
  provider: 'linear' as const,
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'ORG-1',
  title: '日本語',
  description: '成果',
  url: 'https://linear.app/example/issue/ORG-1/example',
};
test('Linear import maps existing issue to pending WorkItem through injected writer and preserves source', async () => {
  let calls = 0;
  const result = await importLinearWorkItem(
    {
      importWorkItemOnce: (task) => {
        calls++;
        assert.equal(task.id, 'linear:issue:' + issue.id);
        assert.equal(task.kind, 'work_item');
        assert.equal(task.status, 'pending');
        assert.equal(task.externalRef, issue.url);
        assert.deepEqual(task.labels, ['ORG-1']);
        assert.ok(task.objective.includes(issue.description));
        assert.ok(task.objective.includes(issue.url));
        return task;
      },
    },
    async () => issue,
    '2026-10-06T00:00:00Z',
  );
  assert.equal(calls, 1);
  assert.equal(result.title, issue.title);
});
