import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createSession, transitionSession } from '../src/sessions/domain.js';
test('Session identity stays separate while turn lifecycle rejects concurrent starts and provider replacement', () => {
  const initial = createSession(
    { agentId: 'agent', roomId: 'room', runtime: 'codex' },
    { id: 'session', at: 't0' },
  );
  assert.equal(initial.providerSessionId, null);
  const running = transitionSession(initial, { type: 'begin', at: 't1' });
  assert.throws(() => transitionSession(running, { type: 'begin', at: 't2' }));
  const idle = transitionSession(running, {
    type: 'complete',
    providerSessionId: 'provider',
    at: 't2',
  });
  assert.equal(idle.id, 'session');
  assert.equal(idle.roomId, 'room');
  assert.equal(idle.providerSessionId, 'provider');
  const next = transitionSession(idle, { type: 'begin', at: 't3' });
  assert.throws(() =>
    transitionSession(next, { type: 'complete', providerSessionId: 'other', at: 't4' }),
  );
  const failed = transitionSession(next, { type: 'fail', error: 'timeout', at: 't4' });
  assert.equal(failed.error, 'timeout');
  const stopped = transitionSession(failed, { type: 'stop', at: 't5' });
  assert.equal(stopped.status, 'stopped');
  assert.equal(transitionSession(stopped, { type: 'begin', at: 't6' }).status, 'running');
  assert.equal(initial.version, 0);
  assert.equal(stopped.version, 5);
  assert.throws(() =>
    transitionSession(initial, { type: 'complete', providerSessionId: 'x', at: 't1' }),
  );
});
