import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createEvent, createSubscription, matchesSubscription } from '../src/events/domain.js';
const identity = { id: 'e', createdAt: '2026-10-04T00:00:00Z' };
test('event patterns match whole segments and JSON filters ignore object key order', () => {
  const event = createEvent(
    {
      type: 'github.pr.opened',
      source: 'manual',
      payload: { repo: 'example', nested: { a: 1, b: [true, null] } },
    },
    identity,
  );
  const sub = (pattern: string) =>
    createSubscription(
      { subscriberType: 'agent', subscriberId: 'reviewer', eventPattern: pattern },
      { ...identity, id: 's' },
    );
  assert.equal(matchesSubscription(sub('github.*.opened'), event), true);
  assert.equal(matchesSubscription(sub('github.**'), event), true);
  assert.equal(matchesSubscription(sub('github.pr.opened.**'), event), true);
  assert.equal(matchesSubscription(sub('github.*'), event), false);
  assert.throws(() => sub('git*.pr.opened'));
  assert.equal(matchesSubscription({ ...sub('**'), enabled: false }, event), false);
  assert.equal(
    matchesSubscription({ ...sub('**'), filter: { nested: { b: [true, null], a: 1 } } }, event),
    true,
  );
  assert.equal(matchesSubscription({ ...sub('**'), filter: { repo: 'other' } }, event), false);
  assert.equal(matchesSubscription({ ...sub('**'), filter: { missing: null } }, event), false);
  assert.equal(matchesSubscription({ ...sub('**'), filter: { nested: { a: 1 } } }, event), false);
});
test('event creation copies payload and rejects malformed event names and patterns', () => {
  const payload = { nested: { value: 'original' } };
  const event = createEvent({ type: 'manual.requested', source: 'manual', payload }, identity);
  payload.nested.value = 'changed';
  assert.deepEqual(event.payload, { nested: { value: 'original' } });
  for (const type of ['', 'a..b', 'a.*', 'a b'])
    assert.throws(() => createEvent({ type, source: 'manual' }, identity));
  for (const eventPattern of ['', 'a..b', 'a.**.b'])
    assert.throws(() =>
      createSubscription({ subscriberType: 'agent', subscriberId: 'a', eventPattern }, identity),
    );
});
