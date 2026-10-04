import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { LocalAgentRuntime } from '../src/runtime/manager.js';
const agents = {
  list: () => [{ id: 'a', name: 'chief', role: 'Chief', runtime: 'codex', createdAt: 't0' }],
};
const rooms = {
  get: () => ({
    id: 'r',
    title: 'work',
    type: 'agent' as const,
    participants: [{ kind: 'agent' as const, id: 'a' }],
    activationPolicy: 'coordinator' as const,
    taskId: null,
    createdAt: 't0',
    archivedAt: null,
  }),
};
test('Runtime manager selects driver, persists start/resume, and blocks resume until stop has drained', async () => {
  const store = new SqliteSessionStore(':memory:');
  let finish: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const driver = async (input: { message: string }, signal?: AbortSignal) => {
    if (input.message === 'wait') {
      await new Promise<void>((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            finish = resolve;
          },
          { once: true },
        );
        entered?.();
      });
      throw new Error('cancelled');
    }
    return { sessionId: 'provider', text: input.message };
  };
  const runtime = new LocalAgentRuntime(
    store,
    agents,
    rooms,
    { codex: driver, claude: async () => assert.fail('wrong driver') },
    () => 'now',
    () => 's',
  );
  try {
    const started = await runtime.start({
      agentId: 'a',
      roomId: 'r',
      message: 'first',
      instruction: '',
    });
    assert.equal(started.session.id, 's');
    assert.equal((await runtime.resume('s', 'resumed')).text, 'resumed');
    const pending = runtime.send('s', 'wait');
    const rejected = assert.rejects(pending);
    await ready;
    const stopped = runtime.stop('s');
    await assert.rejects(runtime.resume('s', 'too early'), /running|active/);
    assert.equal(store.get('s').status, 'stopped');
    finish?.();
    await stopped;
    await rejected;
    assert.equal((await runtime.resume('s', 'after stop')).text, 'after stop');
    await runtime.shutdown();
  } finally {
    finish?.();
    await runtime.shutdown();
    store.close();
  }
});

test('Runtime owns an active turn before a driver startup callback requests shutdown', async () => {
  const store = new SqliteSessionStore(':memory:');
  let release: (() => void) | undefined;
  let notify: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    notify = resolve;
  });
  let shutdown: Promise<void> | undefined;
  const driver = async (_input: unknown, signal?: AbortSignal) => {
    const pending = new Promise<void>((resolve) => {
      release = resolve;
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    shutdown = runtime.shutdown();
    notify?.();
    await pending;
    throw new Error('cancelled');
  };
  const runtime = new LocalAgentRuntime(
    store,
    agents,
    rooms,
    { codex: driver, claude: driver },
    () => 'now',
    () => 's',
  );
  const start = runtime.start({ agentId: 'a', roomId: 'r', message: 'first', instruction: '' });
  const rejected = assert.rejects(start);
  try {
    await ready;
    assert.equal(store.get('s').status, 'stopped');
    await rejected;
    await shutdown;
  } finally {
    release?.();
    await rejected;
    await runtime.shutdown();
    store.close();
  }
});

test('Runtime shutdown drains every driver even when one stop cannot persist and rejects future starts', async () => {
  const database = new SqliteSessionStore(':memory:');
  const releases: (() => void)[] = [];
  let notify: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const driver = async (_input: unknown, signal?: AbortSignal): Promise<never> =>
    new Promise((_resolve, reject) => {
      const release = () => reject(new Error('cancelled'));
      releases.push(release);
      signal?.addEventListener('abort', release, { once: true });
      if (releases.length === 2) notify?.();
    });
  let sequence = 0;
  const runtime = new LocalAgentRuntime(
    {
      create: (session) => database.create(session),
      get: (id) => database.get(id),
      list: () => database.list(),
      save: (session, version) => {
        if (session.id === 's1' && session.status === 'stopped')
          throw new Error('stop write failed');
        database.save(session, version);
      },
    },
    agents,
    rooms,
    { codex: driver, claude: driver },
    () => 'now',
    () => `s${++sequence}`,
  );
  const input = { agentId: 'a', roomId: 'r', message: 'wait', instruction: '' };
  const rejected = [assert.rejects(runtime.start(input)), assert.rejects(runtime.start(input))];
  try {
    await ready;
    await assert.rejects(runtime.shutdown(), AggregateError);
    await Promise.all(rejected);
    assert.equal(database.get('s1').status, 'failed');
    assert.equal(database.get('s2').status, 'stopped');
    await assert.rejects(runtime.start(input), /closed/);
  } finally {
    for (const release of releases) release();
    await Promise.all(rejected);
    await runtime.shutdown();
    database.close();
  }
});
