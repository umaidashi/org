import type { MemoryOperationContext } from '../src/memory/port.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { planTaskReview } from '../src/tasks/review.js';
import type { Memory } from '../src/memory/domain.js';
import { projectReviewedTaskMemories } from '../src/memory/reviews.js';

test('Reviewed Task Memory uses explicit owner policy and verified historical facts without rerunning work', () => {
  const agent = createAgent(
    { name: 'reader', role: 'Reader', runtime: 'codex', memoryPolicy: 'reviewed-tasks' },
    { id: 'a', createdAt: 'now' },
  );
  assert.equal(agent.memoryPolicy, 'reviewed-tasks');
  assert.throws(() =>
    createAgent(
      { name: 'invalid', role: 'Reader', runtime: 'codex', memoryPolicy: 'all' },
      { id: 'bad', createdAt: 'now' },
    ),
  );
  const initial = createTask(
    { kind: 'execution_task', title: 'Original title', objective: 'Original objective' },
    { id: 't', createdAt: '2026-10-05T00:00:00.000Z' },
  );
  const assigned = changeTask(initial, { owner: 'a' }, initial.createdAt);
  const running = changeTask(assigned, { status: 'running' }, initial.createdAt);
  const before = {
    ...running,
    status: 'waiting_approval' as const,
    version: 4,
    outputArtifacts: ['out'],
  };
  const review = planTaskReview(
    before,
    { decision: 'approve', actor: 'founder', reason: 'Verified', expectedVersion: 4 },
    { id: 'review', createdAt: initial.createdAt },
  );
  const after = changeTask(before, { status: 'completed' }, review.createdAt);
  const history = [before, after].map((task) => ({
    version: task.version,
    status: task.status,
    at: task.updatedAt,
    task,
  }));
  const tasks = {
    list: () => [{ ...after, title: 'Changed later' }],
    history: () => history,
    reviews: () => [review],
  };
  const memories: Memory[] = [];
  const contexts: (MemoryOperationContext | undefined)[] = [];
  const writer = {
    createOnce: (memory: Memory, context?: MemoryOperationContext) => {
      contexts.push(context);
      memories.push(memory);
      return memory;
    },
  };
  projectReviewedTaskMemories(writer, { list: () => [agent] }, tasks);
  assert.equal(memories.length, 1);
  assert.deepEqual(contexts[0], {
    actor: { kind: 'system', id: 'memory.review-projection' },
    taskId: 't',
  });
  const memory = memories[0];
  assert.ok(memory);
  assert.equal(memory.type, 'episodic');
  assert.equal(memory.scope, 'task:t');
  assert.deepEqual(memory.sourceRefs, [{ uri: 'org://tasks/t/reviews/review' }]);
  const fact = JSON.parse(memory.content) as {
    title: string;
    review: { decision: string; actor: string };
  };
  assert.equal(fact.title, 'Original title');
  assert.equal(fact.review.actor, 'founder');
  assert.equal(fact.review.decision, 'approve');
  memories.length = 0;
  projectReviewedTaskMemories(writer, { list: () => [{ ...agent, memoryPolicy: 'none' }] }, tasks);
  assert.equal(memories.length, 0);
  projectReviewedTaskMemories(
    writer,
    { list: () => [agent] },
    { ...tasks, reviews: () => [{ ...review, decision: 'reject' }] },
  );
  assert.equal(memories.length, 0);
  assert.throws(() =>
    projectReviewedTaskMemories(
      writer,
      { list: () => [agent] },
      { ...tasks, reviews: () => [{ ...review, outputArtifacts: ['foreign'] }] },
    ),
  );
  assert.equal(memories.length, 0);
  const cancel = new AbortController();
  cancel.abort();
  projectReviewedTaskMemories(
    writer,
    {
      list: () => {
        throw new Error('unexpected read');
      },
    },
    tasks,
    cancel.signal,
  );
});
