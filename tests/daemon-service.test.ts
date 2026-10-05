import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createEvent, createSubscription } from '../src/events/domain.js';
import { planDeliveries } from '../src/daemon/domain.js';
import { dispatchEvents } from '../src/daemon/service.js';
test('pure delivery identity is stable and unambiguous, and disabled subscriptions do not dispatch', () => {
  const event = createEvent(
    { type: 'manual.requested', source: 'manual' },
    { id: 'a:b', createdAt: 'now' },
  );
  const subscription = createSubscription(
    { subscriberType: 'agent', subscriberId: 'dev', eventPattern: '**' },
    { id: 'c', createdAt: 'later' },
  );
  const plan = planDeliveries([event], [subscription]);
  assert.equal(plan.length, 1);
  assert.deepEqual(planDeliveries([event], [subscription]), plan);
  assert.notEqual(
    plan[0]?.key,
    planDeliveries([{ ...event, id: 'a' }], [{ ...subscription, id: 'b:c' }])[0]?.key,
  );
  assert.deepEqual(planDeliveries([event], [{ ...subscription, enabled: false }]), []);
});
test('receipt failure after Task success retries the same identity through injected Ports', () => {
  const event = createEvent(
    { type: 'manual.requested', source: 'manual' },
    { id: 'e', createdAt: 'now' },
  );
  const subscription = createSubscription(
    { subscriberType: 'agent', subscriberId: 'dev', eventPattern: '**' },
    { id: 's', createdAt: 'later' },
  );
  const ids: string[] = [];
  const taskWriter = {
    createAssignedOnce: (task: import('../src/tasks/domain.js').Task) => {
      ids.push(task.id);
      return task;
    },
  };
  const receipt: import('../src/daemon/domain.js').Delivery = {
    key: 'delivery:1:e:s',
    eventId: 'e',
    subscriptionId: 's',
    taskId: null,
    status: 'pending',
    attempts: 1,
    reason: null,
  };
  const journal = {
    begin: () => receipt,
    complete: () => {
      throw new Error('receipt failure');
    },
    defer: () => {
      throw new Error('unused');
    },
    list: () => [],
  };
  const bus = { list: () => [event], subscriptions: () => [subscription] };
  const agents = {
    list: () => [{ id: 'dev', name: 'Dev', role: 'Developer', runtime: 'codex', createdAt: 'now' }],
  };
  for (let i = 0; i < 2; i++)
    assert.throws(() => dispatchEvents(bus, agents, taskWriter, journal), /receipt failure/);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('independent polling stages continue after failure and preserve errors', async () => {
  const { pollDaemonStages } = await import('../src/daemon/service.js');
  const calls: number[] = [];
  await assert.rejects(
    pollDaemonStages([
      () => {
        calls.push(1);
        throw Error('observation failed');
      },
      () => {
        calls.push(2);
      },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      assert.ok(error.errors[0] instanceof Error);
      assert.equal(error.errors[0].message, 'observation failed');
      return true;
    },
  );
  assert.deepEqual(calls, [1, 2]);
  await pollDaemonStages(
    [
      () => {
        calls.push(3);
      },
    ],
    AbortSignal.abort(),
  );
  assert.deepEqual(calls, [1, 2]);
});
