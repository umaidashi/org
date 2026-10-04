import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { releaseResources } from '../src/daemon/service.js';
test('resource release attempts every close and propagates collected close failures', () => {
  const calls: string[] = [];
  assert.throws(
    () =>
      releaseResources([
        {
          close: () => {
            calls.push('task');
            throw new Error('task close failure');
          },
        },
        {
          close: () => {
            calls.push('agent');
            throw new Error('agent close failure');
          },
        },
        {
          close: () => {
            calls.push('event');
          },
        },
      ]),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  assert.deepEqual(calls, ['task', 'agent', 'event']);
});
