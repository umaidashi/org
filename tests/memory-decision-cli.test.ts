import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cli } from './cli-path.js';
import { SqliteApprovalStore } from '../src/approvals/sqlite.js';
import { createApprovalRequest } from '../src/approvals/domain.js';

test('native Memory captures confirmed approve and reject Decision originals across reopen but refuses pending evidence', () => {
  const home = mkdtempSync('/tmp/org-memory-decision-');
  const db = home + '/org.db';
  const run = (args: string[], path = db) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', path, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  const args = [
    'memory',
    'capture',
    '--type',
    'episodic',
    '--scope',
    'company',
    '--content',
    'Decision observed',
    '--confidence',
    '1',
    '--source-decision',
    'decision:日本',
  ];
  const store = new SqliteApprovalStore(db);
  try {
    store.requestOnce(
      createApprovalRequest(
        {
          key: 'decision',
          actor: { kind: 'human', id: 'founder' },
          taskId: null,
          eventId: null,
          operation: {
            kind: 'agent_capabilities',
            agentId: 'worker',
            expectedRevision: 0,
            capabilities: ['can_read'],
          },
        },
        { id: 'decision:日本', createdAt: 'before' },
      ),
    );
    const pending = run(args);
    assert.equal(pending.status, 1, pending.stderr);
    assert.match(pending.stderr, /confirmed Decision/);
    assert.deepEqual(JSON.parse(run(['memory', 'list', '--json']).stdout), []);
    for (const decision of ['approve', 'reject'] as const) {
      const id = decision === 'approve' ? 'decision:日本' : 'rejected';
      if (decision === 'reject')
        store.requestOnce(
          createApprovalRequest(
            {
              ...store.get('decision:日本').request,
              key: 'reject',
            },
            { id, createdAt: 'before' },
          ),
        );
      const decided = run([
        'approval',
        'decide',
        id,
        '--actor',
        'founder',
        '--decision',
        decision,
        '--reason',
        'Fixture judgment',
      ]);
      assert.equal(decided.status, 0, decided.stderr);
      const original = store.get(id);
      const captured = run([...args.slice(0, -1), id, '--json']);
      assert.equal(captured.status, 0, captured.stderr);
      const memory: unknown = JSON.parse(captured.stdout);
      assert.ok(
        memory &&
          typeof memory === 'object' &&
          'id' in memory &&
          typeof memory.id === 'string' &&
          'sourceRefs' in memory,
      );
      assert.deepEqual(memory.sourceRefs, [
        { uri: 'org://approvals/' + encodeURIComponent(id) + '/decision' },
      ]);
      const reopened = run(['memory', 'get', memory.id, '--json']);
      assert.equal(reopened.status, 0, reopened.stderr);
      assert.deepEqual(JSON.parse(reopened.stdout), memory);
      assert.deepEqual(store.get(id), original);
    }
    assert.equal(run([...args.slice(0, -1), 'absent']).status, 1);
    for (const extra of [
      ['--source-event', 'event'],
      ['--source-review', 'org://tasks/t/reviews/r'],
      ['--source-artifact', 'org://artifacts/' + 'a'.repeat(64)],
      ['--room', 'r'],
    ]) {
      const invalid = home + '/invalid.db';
      assert.equal(run([...args, ...extra], invalid).status, 2);
      assert.equal(existsSync(invalid), false);
    }
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
