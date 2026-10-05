import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteApprovalStore } from '../src/approvals/sqlite.js';
import { createApprovalRequest } from '../src/approvals/domain.js';
test('Approval requests and decisions are immutable, idempotent and visible across adapters', () => {
  const home = mkdtempSync('/tmp/org-approval-'),
    path = home + '/org.db';
  const a = new SqliteApprovalStore(path),
    b = new SqliteApprovalStore(path),
    raw = new Database(path);
  const request = createApprovalRequest(
    {
      key: 'key',
      actor: { kind: 'agent', id: 'worker' },
      taskId: null,
      eventId: null,
      operation: {
        kind: 'agent_capabilities',
        agentId: 'worker',
        expectedRevision: 0,
        capabilities: ['can_run_shell'],
      },
    },
    { id: 'request', createdAt: 'before' },
  );
  try {
    assert.deepEqual(a.requestOnce(request), request);
    assert.deepEqual(b.requestOnce({ ...request, id: 'retry', createdAt: 'later' }), request);
    assert.throws(
      () => b.requestOnce({ ...request, operation: { ...request.operation, capabilities: [] } }),
      /conflict/,
    );
    assert.equal(b.get('request').decision, null);
    const input = {
      actor: { kind: 'human' as const, id: 'founder' },
      decision: 'approve' as const,
      reason: 'Verified scope',
    };
    const decided = a.decide('request', input, 'now');
    assert.deepEqual(b.decide('request', input, 'later'), decided);
    assert.throws(() => b.decide('request', { ...input, decision: 'reject' }, 'later'), /conflict/);
    for (const table of ['approval_requests', 'approval_decisions']) {
      assert.throws(() => raw.exec(`DELETE FROM ${table}`), /immutable/);
      assert.throws(() => raw.exec(`UPDATE ${table} SET data='{}'`), /immutable/);
      assert.throws(
        () => raw.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
        /immutable/,
      );
    }
    assert.deepEqual(b.list(), [decided]);
  } finally {
    raw.close();
    a.close();
    b.close();
    rmSync(home, { recursive: true, force: true });
  }
});
