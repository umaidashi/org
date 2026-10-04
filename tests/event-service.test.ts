import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { publishEvent, registerSubscription } from '../src/events/service.js';
test('publishing needs only an injected writer; Agent subscription validates before saving', () => {
  const identity = { id: 'one', createdAt: 'now' };
  const event = publishEvent(
    { publish: (value) => value },
    { type: 'manual.requested', source: 'manual' },
    identity,
  );
  assert.equal(event.id, 'one');
  let writes = 0;
  const bus = {
    subscribe: (value: import('../src/events/domain.js').Subscription) => {
      writes++;
      return value;
    },
  };
  assert.throws(
    () =>
      registerSubscription(
        bus,
        { list: () => [] },
        { subscriberType: 'agent', subscriberId: 'unknown', eventPattern: '**' },
        identity,
      ),
    /not found/,
  );
  assert.equal(writes, 0);
  assert.equal(
    registerSubscription(
      bus,
      {
        list: () => {
          throw new Error('must not read Agents');
        },
      },
      { subscriberType: 'workflow', subscriberId: 'external', eventPattern: '**' },
      identity,
    ).subscriberType,
    'workflow',
  );
  assert.equal(writes, 1);
});
