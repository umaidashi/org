import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import {
  createApprovalRequest,
  createApprovalDecision,
  requireApprovedPermission,
} from '../src/approvals/domain.js';
test('Permission application and Audit roll back together and preserve the original receipt on retry', () => {
  const home = mkdtempSync('/tmp/org-permission-'),
    path = home + '/org.db';
  const a = new SqliteAgentRepository(path),
    b = new SqliteAgentRepository(path),
    raw = new Database(path),
    actor = { kind: 'human' as const, id: 'founder' };
  const approval = (
    id: string,
    revision: number,
    capabilities: readonly ('can_run_shell' | 'can_write')[],
  ) => {
    const request = createApprovalRequest(
      {
        key: id,
        actor,
        taskId: null,
        eventId: null,
        operation: {
          kind: 'agent_capabilities',
          agentId: 'worker',
          expectedRevision: revision,
          capabilities,
        },
      },
      { id, createdAt: 'before' },
    );
    return requireApprovedPermission({
      request,
      decision: createApprovalDecision(
        request,
        { actor, decision: 'approve', reason: 'Verified' },
        'approved',
      ),
    });
  };
  try {
    a.insert(
      createAgent(
        { name: 'worker', role: 'Code', runtime: 'codex' },
        { id: 'worker', createdAt: 'before' },
      ),
    );
    assert.deepEqual(b.capabilitySnapshot('worker'), {
      agentId: 'worker',
      revision: 0,
      capabilities: [],
    });
    const first = approval('first', 0, ['can_run_shell']);
    raw.exec(
      "CREATE TRIGGER deny_permission_audit BEFORE INSERT ON agent_capability_history BEGIN SELECT RAISE(ABORT,'fixture failure');END;",
    );
    assert.throws(() => a.applyCapabilities(first, actor, 'failed'), /fixture failure/);
    assert.deepEqual(b.capabilitySnapshot('worker'), {
      agentId: 'worker',
      revision: 0,
      capabilities: [],
    });
    assert.deepEqual(b.capabilityHistory('worker'), []);
    raw.exec('DROP TRIGGER deny_permission_audit');
    const receipt = a.applyCapabilities(first, actor, 'applied');
    assert.deepEqual(b.applyCapabilities(first, actor, 'retry'), receipt);
    assert.throws(() => b.applyCapabilities(approval('stale', 0, []), actor, 'later'), /revision/);
    a.applyCapabilities(approval('second', 1, ['can_write']), actor, 'later');
    assert.deepEqual(b.applyCapabilities(first, actor, 'later'), receipt);
    assert.deepEqual(b.capabilitySnapshot('worker').capabilities, ['can_write']);
    assert.equal(b.capabilityHistory('worker').length, 2);
    // Interleave a second connection only if snapshot reading exposes a list/read gap.
    const originalList = b.list.bind(b);
    b.list = () => {
      const rows = originalList();
      a.applyCapabilities(approval('interleaved', 2, ['can_run_shell']), actor, 'interleaved');
      return rows;
    };
    const snapshot = b.capabilitySnapshot('worker');
    b.list = originalList;
    if (snapshot.revision === 2)
      assert.deepEqual(snapshot, { agentId: 'worker', revision: 2, capabilities: ['can_write'] });
    else
      assert.deepEqual(snapshot, {
        agentId: 'worker',
        revision: 3,
        capabilities: ['can_run_shell'],
      });
    for (const sql of [
      'DELETE FROM agent_capability_history',
      "UPDATE agent_capability_history SET data='{}'",
      'INSERT OR REPLACE INTO agent_capability_history SELECT * FROM agent_capability_history',
    ])
      assert.throws(() => raw.exec(sql), /immutable/);
  } finally {
    raw.close();
    a.close();
    b.close();
    rmSync(home, { recursive: true, force: true });
  }
});
