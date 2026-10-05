import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { Event } from '../src/events/domain.js';
import { invokeWorkflow, observeWorkflow } from '../src/workflows/service.js';
test('Workflow claims before invocation, preserves receipt and rejects repeated keys without remote replay', async () => {
  const events = new Map<string, Event>();
  const bus = {
    publish: (event: Event) => {
      if (events.has(event.id)) throw new Error('Duplicate request');
      events.set(event.id, event);
      return event;
    },
    get: (id: string) => {
      const event = events.get(id);
      if (!event) throw new Error('Missing event');
      return event;
    },
  };
  let calls = 0;
  const runtime = {
    invoke: async () => {
      assert.equal(events.get('request')?.type, 'workflow.requested');
      calls++;
      return '12';
    },
    status: async () => ({ id: '12', workflowId: 'build', status: 'success' as const }),
    cancel: async () => 'canceled' as const,
  };
  const input = {
    workflowId: 'build',
    host: 'https://n8n.example',
    input: { marker: 'PRIVATE_INPUT' },
    inputDigest: 'digest',
  };
  const started = await invokeWorkflow(
    bus,
    runtime,
    input,
    { id: 'request', createdAt: '0' },
    () => '1',
  );
  assert.equal(started.payload.executionId, '12');
  assert.ok(!JSON.stringify(Array.from(events.values())).includes('PRIVATE_INPUT'));
  await assert.rejects(
    invokeWorkflow(bus, runtime, input, { id: 'request', createdAt: '2' }, () => '3'),
  );
  assert.equal(calls, 1);
  const observed = await observeWorkflow(bus, runtime, 'request', input.host, 'status', {
    id: 'observed',
    createdAt: '4',
  });
  assert.equal(observed.payload.status, 'success');
  assert.equal(events.get('request')?.createdAt, '0');
  await assert.rejects(
    observeWorkflow(bus, runtime, 'request', 'https://foreign.example', 'cancel', {
      id: 'foreign',
      createdAt: '5',
    }),
  );
  assert.equal(events.has('foreign'), false);
});

test('Workflow invocation failure remains claimed and records an unconfirmed outcome without private error text', async () => {
  const events = new Map<string, Event>();
  const bus = {
    publish: (event: Event) => {
      if (events.has(event.id)) throw new Error('Duplicate');
      events.set(event.id, event);
      return event;
    },
    get: (id: string) => {
      const event = events.get(id);
      assert.ok(event);
      return event;
    },
  };
  let calls = 0;
  const runtime = {
    invoke: async () => {
      calls++;
      throw new Error('PRIVATE_PROVIDER_ERROR');
    },
  };
  const invoke = () =>
    invokeWorkflow(
      bus,
      runtime,
      { workflowId: 'build', host: 'https://n8n.example', input: {}, inputDigest: 'digest' },
      { id: 'request', createdAt: '0' },
      () => '1',
    );
  await assert.rejects(invoke());
  assert.equal(events.get('request:unconfirmed')?.type, 'workflow.unconfirmed');
  await assert.rejects(invoke());
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(Array.from(events.values())).includes('PRIVATE_PROVIDER_ERROR'));
});
