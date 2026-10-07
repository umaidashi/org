import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createSessionForAgent,
  sendSession,
  stopSession,
  recoverSessions,
} from '../src/sessions/service.js';
import { createSession, transitionSession } from '../src/sessions/domain.js';
import type { Session } from '../src/sessions/domain.js';
const agent = {
  id: 'a',
  name: 'chief',
  role: 'Chief',
  runtime: 'codex',
  createdAt: 't0',
  capabilities: ['can_read' as const],
};
const agents = { list: () => [agent] };
const room = {
  id: 'r',
  title: 'work',
  type: 'direct' as const,
  participants: [
    { kind: 'agent' as const, id: 'a' },
    { kind: 'human' as const, id: 'h' },
  ],
  activationPolicy: 'coordinator' as const,
  taskId: null,
  createdAt: 't0',
  archivedAt: null,
};
const rooms = { get: () => room };
function memory() {
  let current = createSession(
    { agentId: 'a', roomId: 'r', runtime: 'codex' },
    { id: 's', at: 't0' },
  );
  return {
    get: () => current,
    list: () => [current],
    save: (next: Session, version: number) => {
      assert.equal(version, current.version);
      current = next;
    },
  };
}
test('Session service validates references before creation and runs explicit provider resume via minimal Ports', async () => {
  let created: Session | undefined;
  const result = createSessionForAgent(
    {
      create: (s) => {
        created = s;
      },
    },
    agents,
    rooms,
    { agentId: 'a', roomId: 'r' },
    { id: 's', at: 't0' },
  );
  assert.equal(created, result);
  assert.throws(() =>
    createSessionForAgent(
      { create: () => assert.fail() },
      { list: () => [] },
      rooms,
      { agentId: 'a', roomId: 'r' },
      { id: 's', at: 't0' },
    ),
  );
  const store = memory();
  for (let index = 0; index < 2; index++) {
    const reply = await sendSession(
      store,
      agents,
      rooms,
      async (input) => {
        assert.equal(store.get().status, 'running');
        assert.equal(input.sessionId, index === 0 ? undefined : 'provider');
        assert.equal(input.agent.role, 'Chief');
        return { sessionId: 'provider', text: 'Done' };
      },
      { id: 's', message: 'work', instruction: 'Review' },
      () => 'now',
    );
    assert.equal(reply.session.status, 'idle');
    assert.equal(reply.text, 'Done');
  }
});
test('Session failure and restart recovery preserve provider identity without persisting external error text', async () => {
  const store = memory();
  await assert.rejects(
    sendSession(
      store,
      agents,
      rooms,
      async () => {
        throw new Error('private external detail');
      },
      { id: 's', message: 'x', instruction: '' },
      () => 't1',
    ),
  );
  assert.equal(store.get().status, 'failed');
  assert.ok(!store.get().error?.includes('private'));
  const recovering = memory();
  await sendSession(
    recovering,
    agents,
    rooms,
    async () => ({ sessionId: 'p', text: 'ok' }),
    { id: 's', message: 'x', instruction: '' },
    () => 't1',
  );
  const { transitionSession } = await import('../src/sessions/domain.js');
  recovering.save(
    transitionSession(recovering.get(), { type: 'begin', at: 't2' }),
    recovering.get().version,
  );
  assert.equal(recoverSessions(recovering, 't3').length, 1);
  assert.equal(recovering.get().providerSessionId, 'p');
  assert.deepEqual(recoverSessions(recovering, 't4'), []);
});
test('Session stop wins over a late runtime response and parallel turns are rejected', async () => {
  const store = memory();
  let finish: ((value: { sessionId: string; text: string }) => void) | undefined;
  const turn = sendSession(
    store,
    agents,
    rooms,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    { id: 's', message: 'x', instruction: '' },
    () => 'now',
  );
  await assert.rejects(
    sendSession(
      store,
      agents,
      rooms,
      async () => assert.fail(),
      { id: 's', message: 'x', instruction: '' },
      () => 'now',
    ),
  );
  let cancelled = false;
  stopSession(store, 's', 'now', () => {
    cancelled = true;
  });
  assert.ok(cancelled);
  finish?.({ sessionId: 'p', text: 'late' });
  await assert.rejects(turn);
  assert.equal(store.get().status, 'stopped');
  assert.equal(store.get().providerSessionId, null);
});

test('Session rejects legacy and missing read grants before creation, begin or Runtime invocation', async () => {
  for (const capabilities of [undefined, [], ['can_write'] as const]) {
    const { capabilities: _capabilities, ...legacy } = agent;
    const repository = {
      list: () => [{ ...legacy, ...(capabilities === undefined ? {} : { capabilities }) }],
    };
    assert.throws(
      () =>
        createSessionForAgent(
          { create: () => assert.fail('must not create') },
          repository,
          rooms,
          { agentId: 'a', roomId: 'r' },
          { id: 's', at: 'now' },
        ),
      /can_read/,
    );
    const store = memory();
    await assert.rejects(
      sendSession(
        store,
        repository,
        rooms,
        async () => assert.fail('must not invoke'),
        { id: 's', message: 'read', instruction: 'private context' },
        () => 'now',
      ),
      /can_read/,
    );
    assert.equal(store.get().status, 'idle');
    assert.equal(store.get().version, 0);
  }
});

test.each(['grant', 'runtime', 'archive', 'participant'] as const)(
  'Session refuses late completion after %s changes and preserves the prior provider identity',
  async (change) => {
    let currentAgent = { ...agent };
    let currentRoom: Omit<typeof room, 'archivedAt'> & { archivedAt: string | null } = { ...room };
    const repository = { list: () => [currentAgent] };
    const roomRepository = { get: () => currentRoom };
    const store = memory();
    store.save(transitionSession(store.get(), { type: 'begin', at: 'before' }), 0);
    store.save(
      transitionSession(store.get(), {
        type: 'complete',
        providerSessionId: 'previous-provider',
        at: 'before',
      }),
      1,
    );
    await assert.rejects(
      sendSession(
        store,
        repository,
        roomRepository,
        async () => {
          if (change === 'grant') currentAgent = { ...currentAgent, capabilities: [] };
          if (change === 'runtime') currentAgent = { ...currentAgent, runtime: 'claude' };
          if (change === 'archive') currentRoom = { ...currentRoom, archivedAt: 'now' };
          if (change === 'participant') currentRoom = { ...currentRoom, participants: [] };
          return { sessionId: 'new-provider', text: 'private response' };
        },
        { id: 's', message: 'read', instruction: 'context' },
        () => 'now',
      ),
      /can_read|runtime changed|archived|participant/,
    );
    assert.equal(store.get().status, 'failed');
    assert.equal(store.get().providerSessionId, 'previous-provider');
  },
);
