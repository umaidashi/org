import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { createSession, transitionSession } from '../src/sessions/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { createRoom } from '../src/rooms/domain.js';
import { rebuildSessionForAgent } from '../src/sessions/reconstruction.js';
test('Session reconstruction atomically retires a failed provider and creates fresh identity without replaying a turn', () => {
  const store = new SqliteSessionStore(':memory:');
  const agent = createAgent(
      { name: 'worker', role: 'check', runtime: 'codex' },
      { id: 'worker', createdAt: 'before' },
    ),
    room = createRoom(
      {
        title: 'Room',
        type: 'direct',
        participants: [
          { kind: 'human', id: 'founder' },
          { kind: 'agent', id: agent.id },
        ],
      },
      { id: 'room', createdAt: 'before' },
    );
  const agents = { list: () => [agent] },
    rooms = { get: () => room };
  let current = createSession(
    { agentId: agent.id, roomId: room.id, runtime: 'codex' },
    { id: 'original', at: 'before' },
  );
  store.create(current);
  const apply = (action: Parameters<typeof transitionSession>[1]) => {
    const next = transitionSession(current, action);
    store.save(next, current.version);
    current = next;
  };
  apply({ type: 'begin', at: 'before' });
  apply({ type: 'complete', at: 'before', providerSessionId: 'broken' });
  apply({ type: 'begin', at: 'now' });
  apply({ type: 'fail', at: 'now', error: 'Provider unavailable' });
  try {
    assert.throws(
      () =>
        rebuildSessionForAgent(
          store,
          agents,
          rooms,
          { id: current.id, expectedVersion: current.version - 1 },
          { id: 'stale', at: 'later' },
        ),
      /version/,
    );
    assert.throws(
      () =>
        rebuildSessionForAgent(
          store,
          agents,
          { get: () => ({ ...room, archivedAt: 'now' }) },
          { id: current.id, expectedVersion: current.version },
          { id: 'archived', at: 'later' },
        ),
      /archived/,
    );
    store.create(
      createSession(
        { agentId: agent.id, roomId: room.id, runtime: 'codex' },
        { id: 'collision', at: 'before' },
      ),
    );
    assert.throws(() =>
      rebuildSessionForAgent(
        store,
        agents,
        rooms,
        { id: current.id, expectedVersion: current.version },
        { id: 'collision', at: 'later' },
      ),
    );
    assert.equal(store.get(current.id).status, 'failed');
    assert.equal(store.get(current.id).version, current.version);
    assert.equal(store.history(current.id).length, current.version + 1);
    const next = rebuildSessionForAgent(
      store,
      agents,
      rooms,
      { id: current.id, expectedVersion: current.version },
      { id: 'rebuilt', at: 'later' },
    );
    assert.equal(next.providerSessionId, null);
    assert.equal(next.status, 'idle');
    assert.deepEqual(next.rebuiltFrom, { sessionId: current.id, version: current.version });
    assert.equal(store.get(current.id).status, 'stopped');
    assert.equal(store.history(current.id).at(-2)?.status, 'failed');
    assert.equal(store.history(next.id).length, 1);
    assert.throws(() =>
      rebuildSessionForAgent(
        store,
        agents,
        rooms,
        { id: current.id, expectedVersion: current.version },
        { id: 'retry', at: 'later' },
      ),
    );
  } finally {
    store.close();
  }
});

test('Session reconstruction validates current authority before the injected atomic store without a database', () => {
  const agent = createAgent(
      { name: 'worker', role: 'check', runtime: 'codex' },
      { id: 'worker', createdAt: 'before' },
    ),
    room = createRoom(
      {
        title: 'Room',
        type: 'direct',
        participants: [
          { kind: 'human', id: 'founder' },
          { kind: 'agent', id: agent.id },
        ],
      },
      { id: 'room', createdAt: 'before' },
    );
  const initial = createSession(
      { agentId: agent.id, roomId: room.id, runtime: 'codex' },
      { id: 'original', at: 'before' },
    ),
    failed = transitionSession(transitionSession(initial, { type: 'begin', at: 'now' }), {
      type: 'fail',
      error: 'failure',
      at: 'now',
    });
  let writes = 0;
  const store = {
    get: () => failed,
    rebuildSession: (_id: string, _version: number, next: typeof failed) => {
      writes++;
      return next;
    },
  };
  const args = { id: failed.id, expectedVersion: failed.version },
    identity = { id: 'fresh', at: 'later' };
  assert.throws(
    () => rebuildSessionForAgent(store, { list: () => [] }, { get: () => room }, args, identity),
    /Agent/,
  );
  assert.equal(writes, 0);
  assert.throws(
    () =>
      rebuildSessionForAgent(
        { ...store, get: () => initial },
        { list: () => [agent] },
        { get: () => room },
        { ...args, expectedVersion: 0 },
        identity,
      ),
    /failed/,
  );
  assert.equal(writes, 0);
  const next = rebuildSessionForAgent(
    store,
    { list: () => [agent] },
    { get: () => room },
    args,
    identity,
  );
  assert.equal(writes, 1);
  assert.equal(next.providerSessionId, null);
  assert.equal(next.agentId, failed.agentId);
  assert.equal(next.roomId, failed.roomId);
});
