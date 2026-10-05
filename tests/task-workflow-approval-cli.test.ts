import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
import { createRoom } from '../src/rooms/domain.js';

test('real CLI fixes Task Workflow approval proposal, preserves it across human decision and rejects stale references', () => {
  const home = mkdtempSync('/tmp/org-task-approval-'),
    db = home + '/org.db';
  const a = new SqliteAgentRepository(db),
    t = new SqliteTaskProvider(db),
    r = new SqliteRoomRepository(db);
  let version: number;
  try {
    a.insert(
      createAgent(
        {
          name: 'worker',
          role: 'check',
          runtime: 'codex',
          capabilities: [
            'can_read',
            'can_delegate',
            'can_access_network',
            'can_contact_external',
            'can_write',
          ],
        },
        { id: 'a', createdAt: '0' },
      ),
    );
    t.create(
      createTask(
        { title: 'check', objective: 'approved operation', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
    );
    version = t.update('t', { owner: 'a' }, '1').version;
    r.create(
      createRoom(
        { title: 'task', type: 'task', taskId: 't', participants: [{ kind: 'agent', id: 'a' }] },
        { id: 'r', createdAt: '0' },
      ),
    );
    r.append(
      'r',
      {
        sender: { kind: 'agent', id: 'a' },
        content: '{"version":1,"tool":"workflow","workflowId":"flow","input":{"marker":"test"}}',
      },
      { id: 'm', createdAt: '2' },
    );
  } finally {
    r.close();
    t.close();
    a.close();
  }
  const run = (args: string[], path = db) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', path, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  const args = [
    'approval',
    'request-task-workflow',
    't',
    '--room',
    'r',
    '--message',
    'm',
    '--expected-version',
    String(version),
    '--host',
    'https://n8n.example',
    '--effect',
    'write',
    '--json',
  ];
  try {
    const first = run(args);
    assert.equal(first.status, 0, first.stderr);
    const request: unknown = JSON.parse(first.stdout);
    assert.ok(
      request && typeof request === 'object' && 'id' in request && typeof request.id === 'string',
    );
    const repeat = run(args);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.deepEqual(JSON.parse(repeat.stdout), request);
    const decided = run([
      'approval',
      'decide',
      request.id,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'Checked exact proposal',
      '--json',
    ]);
    assert.equal(decided.status, 0, decided.stderr);
    const reopened = run(['approval', 'get', request.id, '--json']);
    assert.equal(reopened.status, 0, reopened.stderr);
    const value: unknown = JSON.parse(reopened.stdout);
    assert.ok(value && typeof value === 'object' && 'request' in value);
    assert.deepEqual(value.request, request);
    assert.equal(run(['approval', 'apply', request.id, '--actor', 'founder']).status, 1);
    assert.equal(run(args.map((x) => (x === 'm' ? 'missing' : x))).status, 1);
    const invalid = run(
      args.map((x) => (x === String(version) ? '-1' : x)),
      home + '/absent/db',
    );
    assert.equal(invalid.status, 2);
    assert.equal(existsSync(home + '/absent'), false);
    const current = run(['task', 'get', 't', '--json']);
    assert.equal(current.status, 0);
    assert.equal(JSON.parse(current.stdout).status, 'assigned');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
