import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask } from '../src/tasks/domain.js';
import { planTaskReview, reviewTaskResult } from '../src/tasks/review.js';
const base = createTask(
  { kind: 'execution_task', title: 'Research', objective: 'Compare' },
  { id: 'task', createdAt: 'before' },
);
const task = {
  ...base,
  status: 'waiting_approval' as const,
  owner: 'agent',
  outputArtifacts: ['result'],
  version: 4,
};
const input = {
  decision: 'approve' as const,
  actor: 'founder',
  reason: 'Verified',
  expectedVersion: 4,
};
const identity = { id: 'review', createdAt: 'reviewed' };
test('result review captures the exact version, artifacts and actor without mutating the Task', () => {
  const review = planTaskReview(task, input, identity);
  assert.deepEqual(review, {
    ...identity,
    taskId: 'task',
    taskVersion: 4,
    outputArtifacts: ['result'],
    actor: 'founder',
    reason: 'Verified',
    decision: 'approve',
  });
  assert.equal(task.status, 'waiting_approval');
  assert.equal(planTaskReview(task, { ...input, decision: 'reject' }, identity).decision, 'reject');
  for (const invalid of [
    { ...task, kind: 'work_item' as const },
    { ...task, status: 'running' as const },
    { ...task, outputArtifacts: [] },
  ])
    assert.throws(() => planTaskReview(invalid, input, identity));
  for (const invalid of [
    { ...input, expectedVersion: 3 },
    { ...input, actor: ' ' },
    { ...input, reason: ' ' },
  ])
    assert.throws(() => planTaskReview(task, invalid, identity));
});
test('result review uses the injected writer and propagates a concurrent version failure', () => {
  let writes = 0;
  const result = reviewTaskResult(
    {
      get: () => task,
      recordReview: (review) => {
        writes++;
        assert.equal(review.taskVersion, 4);
        return { ...task, status: 'completed', version: 5 };
      },
    },
    task.id,
    input,
    identity,
  );
  assert.equal(result.status, 'completed');
  assert.equal(writes, 1);
  assert.throws(
    () =>
      reviewTaskResult(
        {
          get: () => task,
          recordReview: () => {
            throw new Error('version conflict');
          },
        },
        task.id,
        input,
        identity,
      ),
    /version conflict/,
  );
});
