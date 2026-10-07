import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';
import { consolidateMemories } from '../src/memory/consolidation.js';
import { collectAudit } from '../src/audit/service.js';

test('Memory mutation Audit records actual actor/time, idempotency, immutable rollback and reopen', () => {
  const home = mkdtempSync('/tmp/org-memory-audit-'),
    path = home + '/org.db';
  const actor = { kind: 'system' as const, id: 'test-host' },
    at = '2026-10-07T00:00:00.000Z';
  let store = new SqliteMemoryProvider(path, actor, () => at);
  const original = (id: string, content = 'synthetic', supersedes?: string) =>
    createMemory(
      {
        type: 'semantic',
        scope: 'global',
        content,
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: 'm' }],
        ...(supersedes ? { supersedes } : {}),
      },
      { id, at: 'old' },
    );
  const audit = () =>
    collectAudit(
      { list: () => [] },
      { configurationHistory: () => [], capabilityHistory: () => [] },
      { list: () => [], history: () => [] },
      { list: () => [] },
      store,
      { operationHistory: () => [] },
    );
  try {
    store.createOnce(original('one'));
    const first = audit();
    assert.equal(first.length, 1);
    assert.deepEqual(first[0], {
      id: 'memory:operation:1',
      causalId: 'org://memory-operations',
      actor,
      taskId: null,
      eventId: null,
      tool: 'memory.capture',
      inputRef: 'org://memories/one',
      outputRef: 'org://memories/one',
      at,
      result: 'succeeded',
      approvalId: null,
    });
    store.createOnce(original('one'));
    assert.deepEqual(audit(), first);
    store.create(original('two', 'updated', 'one'), { actor: { kind: 'agent', id: 'extractor' } });
    assert.equal(audit()[1]?.tool, 'memory.supersede');
    assert.deepEqual(audit()[1]?.actor, { kind: 'agent', id: 'extractor' });
    assert.equal(audit()[1]?.inputRef, 'org://memories/one');
    store.invalidate('two', 'obsolete', 'source-time');
    assert.equal(audit()[2]?.tool, 'memory.invalidate');
    store.create(original('three'));
    store.create(original('four'));
    const request = { scope: 'global', key: 'duplicate-check', at };
    consolidateMemories(store, store, request, () => {});
    const complete = audit();
    assert.equal(complete.at(-1)?.tool, 'memory.consolidate');
    consolidateMemories(store, store, request, () => {});
    store.listConsolidations('global');
    assert.deepEqual(audit(), complete);
    const raw = new Database(path);
    try {
      raw.exec(
        "CREATE TRIGGER fail_memory_audit BEFORE INSERT ON memory_operation_history BEGIN SELECT RAISE(ABORT,'record failure');END;",
      );
      assert.throws(() => store.create(original('rollback')), /record failure/);
      assert.throws(() => store.get('rollback'), /missing/);
      assert.throws(() => store.invalidate('four', 'reason', 'time'), /record failure/);
      assert.equal(store.get('four').status, 'active');
      assert.throws(
        () => consolidateMemories(store, store, { scope: 'global', key: 'rollback', at }, () => {}),
        /record failure/,
      );
      assert.equal(store.getConsolidation('rollback'), null);
      assert.deepEqual(audit(), complete);
      raw.exec('DROP TRIGGER fail_memory_audit');
      for (const sql of [
        'DELETE FROM memory_operation_history',
        "UPDATE memory_operation_history SET data='{}'",
        'INSERT OR REPLACE INTO memory_operation_history SELECT * FROM memory_operation_history LIMIT 1',
      ])
        assert.throws(() => raw.exec(sql), /immutable/);
    } finally {
      raw.close();
    }
    store.close();
    store = new SqliteMemoryProvider(path, actor, () => at);
    assert.deepEqual(audit(), complete);
    const legacy = new Database(path);
    legacy.exec('DROP TABLE memory_operation_history');
    legacy.close();
    store.close();
    store = new SqliteMemoryProvider(path, actor, () => at);
    assert.equal(store.list().length, 4);
    assert.deepEqual(audit(), []);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
