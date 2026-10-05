import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createEvent, createSubscription, type Event } from '../src/events/domain.js';
import { pollWorkflowDeliveries } from '../src/workflows/delivery.js';

test('Workflow subscription claims once, recovers receipt without replay and excludes its own receipt events', async () => {
  const original = createEvent(
    { type: 'manual.requested', source: 'manual', payload: { value: 1 } },
    { id: 'event', createdAt: 'now' },
  );
  const subscription = createSubscription(
    { subscriberType: 'workflow', subscriberId: 'flow', eventPattern: '**' },
    { id: 'subscription', createdAt: 'now' },
  );
  const events = new Map<string, Event>([[original.id, original]]);
  const bus = {
    list: () => [...events.values()],
    subscriptions: () => [subscription],
    get: (id: string) => {
      const value = events.get(id);
      if (!value) throw new Error('Event not found');
      return value;
    },
    publish: (event: Event) => {
      if (events.has(event.id)) throw new Error('Duplicate Event');
      events.set(event.id, event);
      return event;
    },
  };
  let calls = 0,
    completed = false,
    failReceipt = true;
  const journal = {
    begin: () => ({
      key: 'delivery:5:event:subscription',
      eventId: original.id,
      subscriptionId: subscription.id,
      taskId: null,
      status: 'pending' as const,
      attempts: 1,
      reason: null,
    }),
    completeWorkflow: (key: string, requestId: string) => {
      if (failReceipt) {
        failReceipt = false;
        throw new Error('receipt failure');
      }
      completed = true;
      return {
        key,
        eventId: original.id,
        subscriptionId: subscription.id,
        taskId: null,
        workflowRequestId: requestId,
        status: 'delivered' as const,
        attempts: 1,
        reason: null,
      };
    },
    defer: () => {
      throw new Error('unexpected defer');
    },
  };
  const runtime = {
    invoke: async () => {
      calls++;
      assert.ok([...events.values()].some((e) => e.type === 'workflow.requested'));
      return '1';
    },
  };
  const poll = () =>
    pollWorkflowDeliveries(
      bus,
      journal,
      { runtime, host: 'http://127.0.0.1:1', workflows: new Set(['flow']) },
      () => 'now',
    );
  await assert.rejects(poll(), /receipt failure/);
  assert.equal(calls, 1);
  assert.equal(completed, false);
  await poll();
  assert.equal(calls, 1);
  assert.equal(completed, true);
  assert.equal(events.size, 3);
});

test('unconfirmed Workflow outcomes never replay and aborted polls do not claim or invoke', async () => {
  const event = createEvent(
    { type: 'manual.requested', source: 'manual' },
    { id: 'event', createdAt: 'now' },
  );
  const subscription = createSubscription(
    { subscriberType: 'workflow', subscriberId: 'flow', eventPattern: '**' },
    { id: 'subscription', createdAt: 'now' },
  );
  const events = new Map([[event.id, event]]);
  let calls = 0,
    begins = 0;
  const bus = {
    list: () => [...events.values()],
    subscriptions: () => [subscription],
    publish: (value: Event) => {
      assert.ok(!events.has(value.id));
      events.set(value.id, value);
      return value;
    },
  };
  const journal = {
    begin: () => {
      begins++;
      return {
        key: 'delivery:5:event:subscription',
        eventId: event.id,
        subscriptionId: subscription.id,
        taskId: null,
        status: 'pending' as const,
        attempts: 1,
        reason: null,
      };
    },
    completeWorkflow: () => {
      throw new Error('unexpected complete');
    },
    defer: (key: string, reason: string) => ({
      key,
      eventId: event.id,
      subscriptionId: subscription.id,
      taskId: null,
      status: 'deferred' as const,
      attempts: 1,
      reason,
    }),
  };
  const configured = {
    host: 'http://127.0.0.1:1',
    workflows: new Set(['flow']),
    runtime: {
      invoke: async (): Promise<string> => {
        calls++;
        throw new Error('PRIVATE_PROVIDER_ERROR');
      },
    },
  };
  await pollWorkflowDeliveries(bus, journal, configured, () => 'now', AbortSignal.abort());
  assert.equal(begins, 0);
  assert.equal(events.size, 1);
  const first = await pollWorkflowDeliveries(bus, journal, configured, () => 'now');
  const second = await pollWorkflowDeliveries(
    bus,
    journal,
    { ...configured, host: 'http://127.0.0.1:2' },
    () => 'now',
  );
  assert.equal(calls, 1);
  assert.equal(first[0]?.status, 'deferred');
  assert.equal(second[0]?.status, 'deferred');
  assert.equal(events.size, 3);
  assert.ok(
    !JSON.stringify([...events.values(), first, second]).includes('PRIVATE_PROVIDER_ERROR'),
  );
});
