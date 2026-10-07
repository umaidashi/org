import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
test('CLI applies a human-approved permission once and exposes its immutable Audit', () => {
  const home = mkdtempSync('/tmp/org-approval-cli-'),
    db = home + '/org.db';
  const agents = new SqliteAgentRepository(db);
  agents.insert(
    createAgent(
      { name: 'worker', role: 'Code', runtime: 'codex' },
      { id: 'worker', createdAt: 'before' },
    ),
  );
  agents.close();
  const run = (args: string[], path = db) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', path, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  const json = (args: string[]): unknown => {
    const r = run([...args, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  try {
    const invalid = home + '/absent/org.db';
    assert.equal(
      run(
        [
          'approval',
          'request',
          'worker',
          '--key',
          'bad',
          '--actor',
          'founder',
          '--expected-revision',
          '-1',
        ],
        invalid,
      ).status,
      2,
    );
    assert.equal(existsSync(home + '/absent'), false);
    const args = [
      'approval',
      'request',
      'worker',
      '--key',
      'change',
      '--actor',
      'founder',
      '--expected-revision',
      '0',
      '--capability',
      'can_run_shell',
    ];
    const request = json(args);
    assert.ok(
      request !== null &&
        typeof request === 'object' &&
        'id' in request &&
        typeof request.id === 'string',
    );
    assert.deepEqual(json(args), request);
    assert.equal(run(['approval', 'apply', request.id, '--actor', 'founder']).status, 1);
    assert.deepEqual(json(['agent', 'capabilities', 'worker']), {
      agentId: 'worker',
      revision: 0,
      capabilities: [],
    });
    json([
      'approval',
      'decide',
      request.id,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'Verified scope',
    ]);
    const applied = json(['approval', 'apply', request.id, '--actor', 'founder']);
    assert.deepEqual(json(['approval', 'apply', request.id, '--actor', 'founder']), applied);
    assert.deepEqual(json(['agent', 'capabilities', 'worker']), {
      agentId: 'worker',
      revision: 1,
      capabilities: ['can_run_shell'],
    });
    const audit = json(['audit', 'list']);
    assert.ok(Array.isArray(audit));
    const permissionAudit = audit.filter((entry) => entry.tool !== 'agent.register');
    assert.equal(permissionAudit.length, 3);
    assert.deepEqual(
      permissionAudit.map((entry: unknown) => {
        assert.ok(entry !== null && typeof entry === 'object' && 'result' in entry);
        return entry.result;
      }),
      ['pending', 'approved', 'applied'],
    );
    const rejected = json([
      'approval',
      'request',
      'worker',
      '--key',
      'reject',
      '--actor',
      'founder',
      '--expected-revision',
      '1',
      '--capability',
      'can_write',
    ]);
    assert.ok(
      rejected !== null &&
        typeof rejected === 'object' &&
        'id' in rejected &&
        typeof rejected.id === 'string',
    );
    json([
      'approval',
      'decide',
      rejected.id,
      '--actor',
      'founder',
      '--decision',
      'reject',
      '--reason',
      'Too broad',
    ]);
    assert.equal(run(['approval', 'apply', rejected.id, '--actor', 'founder']).status, 1);
    assert.deepEqual(json(['agent', 'capabilities', 'worker']), {
      agentId: 'worker',
      revision: 1,
      capabilities: ['can_run_shell'],
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
