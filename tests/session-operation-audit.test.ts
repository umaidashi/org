import { selectAuditLogs } from '../src/audit/logs.js';
import { rebuildSessionForAgent } from '../src/sessions/reconstruction.js';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  sendSession,
  stopSession,
  createSessionForAgent,
  recoverSessions,
} from '../src/sessions/service.js';
import { collectAudit } from '../src/audit/service.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { createSession, transitionSession } from '../src/sessions/domain.js';

test('Session Runtime state mutations expose important operation Audit', () => {
  const store = new SqliteSessionStore(':memory:');
  try {
    const session = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'codex' },
      { id: 's', at: 'now' },
    );
    store.create(session);
    store.save(transitionSession(session, { type: 'begin', at: 'later' }), 0);
    const reader = store as unknown as {
      operationHistory?: () => readonly { tool: string; result: string }[];
    };
    assert.equal(
      reader
        .operationHistory?.()
        .filter((entry) => entry.tool === 'session.runtime' && entry.result === 'started').length ??
        0,
      1,
    );
  } finally {
    store.close();
  }
});

test('same-time Session Audit preserves create and repeated Runtime chronology', () => {
  const store = new SqliteSessionStore(':memory:');
  try {
    let session = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'codex' },
      { id: 's', at: 'same' },
    );
    store.create(session);
    for (let i = 0; i < 6; i++) {
      const running = transitionSession(session, { type: 'begin', at: 'same' });
      store.save(running, session.version);
      const completed = transitionSession(running, {
        type: 'complete',
        at: 'same',
        providerSessionId: 'provider',
      });
      store.save(completed, running.version);
      session = completed;
    }
    const records = collectAudit(
      { list: () => [] },
      { configurationHistory: () => [], capabilityHistory: () => [] },
      { list: () => [], history: () => [] },
      { list: () => [] },
      { operationHistory: () => [] },
      store,
      { operationHistory: () => [] },
    );
    assert.deepEqual(
      records.map((entry) => entry.result),
      ['succeeded', ...Array.from({ length: 6 }, () => ['started', 'succeeded']).flat()],
    );
  } finally {
    store.close();
  }
});

test('Session Runtime Audit binds input reference and Task actor, persists failures without copying private input', async () => {
  const store = new SqliteSessionStore(':memory:');
  const agent = {
    id: 'a',
    name: 'a',
    role: 'Worker',
    runtime: 'codex',
    createdAt: 'now',
    capabilities: ['can_read' as const],
  };
  const room = {
    id: 'r',
    title: 'work',
    type: 'task' as const,
    participants: [{ kind: 'agent' as const, id: 'a' }],
    activationPolicy: 'mention_only' as const,
    taskId: 'task',
    createdAt: 'now',
    archivedAt: null,
  };
  let calls = 0;
  try {
    createSessionForAgent(
      store,
      { list: () => [agent] },
      { get: () => room },
      { agentId: 'a', roomId: 'r' },
      { id: 's', at: 'now' },
    );
    assert.equal(store.operationHistory()[0]?.taskId, 'task');
    let observed: unknown;
    const inputReference = (input: unknown) => {
      observed = input;
      return 'org://session-inputs/' + 'a'.repeat(64);
    };
    const send = () =>
      sendSession(
        store,
        { list: () => [agent] },
        { get: () => room },
        async (input) => {
          calls++;
          assert.deepEqual(input, observed);
          throw new Error('private failure');
        },
        { id: 's', message: 'private prompt', instruction: 'private instruction' },
        () => 'same',
        undefined,
        inputReference,
      );
    await assert.rejects(send, /private failure/);
    const entries = store.operationHistory().filter((entry) => entry.tool === 'session.runtime');
    assert.deepEqual(
      entries.map((entry) => entry.result),
      ['started', 'failed'],
    );
    for (const entry of entries) {
      assert.deepEqual(entry.actor, { kind: 'agent', id: 'a' });
      assert.equal(entry.taskId, 'task');
      assert.equal(entry.inputRef, 'org://session-inputs/' + 'a'.repeat(64));
    }
    assert.ok(!JSON.stringify(store.operationHistory()).includes('private'));
    rebuildSessionForAgent(
      store,
      { list: () => [agent] },
      { get: () => room },
      { id: 's', expectedVersion: store.get('s').version },
      { id: 'fresh', at: 'later' },
    );
    assert.equal(store.operationHistory().at(-1)?.taskId, 'task');
    assert.equal(store.operationHistory().at(-1)?.tool, 'session.rebuild');
    assert.equal(store.get('s').status, 'stopped');
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});

test('Session Audit storage failure atomically rolls back, is immutable and survives reopen without legacy backfill', async () => {
  const home = mkdtempSync('/tmp/org-session-audit-'),
    path = home + '/org.db';
  let store = new SqliteSessionStore(path);
  const raw = new Database(path);
  try {
    const session = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'codex' },
      { id: 's', at: 'now' },
    );
    store.create(session);
    raw.exec(
      "CREATE TRIGGER fail_session_audit BEFORE INSERT ON session_operation_history BEGIN SELECT RAISE(ABORT,'record failure');END;",
    );
    const running = transitionSession(session, { type: 'begin', at: 'later' });
    assert.throws(() => store.save(running, 0), /record failure/);
    assert.deepEqual(store.get('s'), session);
    assert.equal(store.history('s').length, 1);
    assert.throws(() => store.create({ ...session, id: 'rollback' }), /record failure/);
    assert.throws(() => store.get('rollback'), /not found/);
    assert.equal(store.operationHistory().length, 1);
    raw.exec('DROP TRIGGER fail_session_audit');
    store.save(running, 0);
    const failed = transitionSession(running, { type: 'fail', error: 'safe reason', at: 'after' });
    store.save(failed, 1);
    raw.exec(
      "CREATE TRIGGER fail_rebuild_audit BEFORE INSERT ON session_operation_history BEGIN SELECT RAISE(ABORT,'record failure');END;",
    );
    const next = {
      ...createSession({ agentId: 'a', roomId: 'r', runtime: 'codex' }, { id: 'next', at: 'new' }),
      rebuiltFrom: { sessionId: 's', version: 2 },
    };
    assert.throws(() => store.rebuildSession('s', 2, next), /record failure/);
    assert.deepEqual(store.get('s'), failed);
    assert.throws(() => store.get('next'), /not found/);
    raw.exec('DROP TRIGGER fail_rebuild_audit');
    stopSession(store, 's', 'stop', () => {});
    const complete = store.operationHistory();
    stopSession(store, 's', 'no-op', () => {});
    assert.deepEqual(store.operationHistory(), complete);
    for (const sql of [
      'DELETE FROM session_operation_history',
      "UPDATE session_operation_history SET data='{}'",
      'INSERT OR REPLACE INTO session_operation_history SELECT * FROM session_operation_history LIMIT 1',
    ])
      assert.throws(() => raw.exec(sql), /immutable/);
    store.close();
    store = new SqliteSessionStore(path);
    assert.deepEqual(store.operationHistory(), complete);
    raw.exec('DROP TABLE session_operation_history');
    store.close();
    store = new SqliteSessionStore(path);
    assert.deepEqual(store.operationHistory(), []);
    assert.equal(store.get('s').status, 'stopped');
  } finally {
    raw.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Task-filtered Audit retains cancellation and restart recovery terminal outcomes', () => {
  const store = new SqliteSessionStore(':memory:');
  try {
    for (const id of ['stop', 'recover']) {
      const session = createSession(
        { agentId: 'a', roomId: 'r', runtime: 'codex' },
        { id, at: 'start' },
      );
      const context = { actor: { kind: 'system' as const, id: 'core' }, taskId: 'task' };
      store.create(session, context);
      store.save(transitionSession(session, { type: 'begin', at: 'running' }), 0, context);
    }
    stopSession(store, 'stop', 'terminal', () => {});
    recoverSessions(store, 'terminal');
    const records = collectAudit(
      { list: () => [] },
      { configurationHistory: () => [], capabilityHistory: () => [] },
      { list: () => [], history: () => [] },
      { list: () => [] },
      { operationHistory: () => [] },
      store,
      { operationHistory: () => [] },
    );
    const outcomes = selectAuditLogs(records, { taskId: 'task', limit: 100 }).filter((entry) =>
      ['canceled', 'failed'].includes(entry.result),
    );
    assert.deepEqual(
      outcomes.map((entry) => entry.result),
      ['canceled', 'failed'],
    );
    for (const entry of outcomes)
      assert.deepEqual(entry.actor, { kind: 'system', id: 'unspecified' });
  } finally {
    store.close();
  }
});
