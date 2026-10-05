import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { pollDelegationReviews } from '../src/a2a/service.js';
import { createA2AMessage, readA2AMessage } from '../src/a2a/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { planTaskReview } from '../src/tasks/review.js';
test('Delegation human review returns one verified decision and retries only notification after Room failure', async () => {
  const room = createRoom(
    {
      title: 'Company',
      type: 'group',
      participants: [
        { kind: 'human', id: 'founder' },
        { kind: 'agent', id: 'chief' },
        { kind: 'agent', id: 'worker' },
      ],
    },
    { id: 'r', createdAt: '0' },
  );
  const source = createA2AMessage(
    room,
    { from: 'chief', to: 'worker', type: 'delegate', payload: {} },
    { id: 'source', createdAt: '1' },
  );
  const original = {
    ...createTask(
      { title: 'work', objective: 'produce', kind: 'execution_task' },
      { id: 'a2a:source', createdAt: '1' },
    ),
    externalRef: 'org://rooms/r/messages/source',
  };
  const ready = {
    ...changeTask(
      changeTask(changeTask(original, { owner: 'worker' }, '2'), { status: 'running' }, '3'),
      { status: 'waiting_approval' },
      '4',
    ),
    outputArtifacts: ['artifact'],
  };
  const review = planTaskReview(
    ready,
    { decision: 'approve', actor: 'founder', reason: 'Verified', expectedVersion: ready.version },
    { id: 'review', createdAt: '5' },
  );
  const completed = changeTask(ready, { status: 'completed' }, '5');
  const history = [ready, completed].map((task) => ({
    version: task.version,
    status: task.status,
    at: task.updatedAt,
    task,
  }));
  const messages = [source];
  let attempts = 0;
  const rooms = {
    list: () => [room],
    get: () => room,
    messages: () => messages,
    append: (
      _id: string,
      input: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      attempts++;
      if (attempts === 1) throw new Error('notification failed');
      const message = createMessage(room, input, identity, source);
      messages.push(message);
      return message;
    },
  };
  const agents = {
    list: () => [
      { id: 'chief', name: 'Chief', role: 'Lead', runtime: 'codex', createdAt: '0' },
      { id: 'worker', name: 'Worker', role: 'Code', runtime: 'codex', createdAt: '0' },
    ],
  };
  const tasks = {
    get: () => completed,
    list: () => [completed],
    history: () => history,
    reviews: () => [review],
  };
  await assert.rejects(pollDelegationReviews(rooms, agents, tasks), /notification failed/);
  await pollDelegationReviews(rooms, agents, tasks);
  await pollDelegationReviews(rooms, agents, tasks);
  assert.equal(attempts, 2);
  assert.equal(messages.length, 2);
  const persisted = messages[1];
  assert.ok(persisted);
  const decision = readA2AMessage(persisted);
  assert.equal(decision.type, 'decision');
  assert.equal(decision.from, 'worker');
  assert.equal(decision.to, 'chief');
  assert.equal(decision.replyTo, source.id);
  assert.equal(decision.correlationId, source.id);
  assert.deepEqual(decision.payload, {
    executionTaskId: completed.id,
    reviewRef: 'org://tasks/a2a%3Asource/reviews/review',
    review,
    taskRef: `org://tasks/a2a%3Asource/versions/${completed.version}`,
  });
  await assert.rejects(
    pollDelegationReviews(rooms, agents, {
      ...tasks,
      reviews: () => [{ ...review, outputArtifacts: ['wrong'] }],
    }),
    /evidence/i,
  );
  const rejectedReview = { ...review, decision: 'reject' as const };
  const rejected = changeTask(ready, { status: 'failed' }, '5');
  let rejectedDecision: ReturnType<typeof readA2AMessage> | undefined;
  await pollDelegationReviews(
    {
      ...rooms,
      messages: () => [source],
      append: (_id, input, identity) => {
        const message = createMessage(room, input, identity, source);
        rejectedDecision = readA2AMessage(message);
        return message;
      },
    },
    agents,
    {
      ...tasks,
      list: () => [rejected],
      history: () =>
        [ready, rejected].map((task) => ({
          version: task.version,
          status: task.status,
          at: task.updatedAt,
          task,
        })),
      reviews: () => [rejectedReview],
    },
  );
  assert.ok(rejectedDecision);
  assert.deepEqual(rejectedDecision.payload, {
    executionTaskId: rejected.id,
    reviewRef: 'org://tasks/a2a%3Asource/reviews/review',
    review: rejectedReview,
    taskRef: `org://tasks/a2a%3Asource/versions/${rejected.version}`,
  });
  await pollDelegationReviews(
    {
      ...rooms,
      list: () => {
        throw new Error('should not read');
      },
    },
    agents,
    tasks,
    AbortSignal.abort(),
  );
  await pollDelegationReviews(
    { ...rooms, list: () => [{ ...room, archivedAt: '6' }] },
    agents,
    tasks,
  );
  assert.equal(attempts, 2);
});
