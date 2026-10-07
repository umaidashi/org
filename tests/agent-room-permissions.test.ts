import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { LocalAgentRuntime } from '../src/runtime/manager.js';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';

const base = { name: 'Worker', role: 'Code', runtime: 'codex', capabilities: ['can_read'] };
const identity = { id: 'worker', createdAt: 'before' };
test('Agent Room permissions use a closed finite allowlist and copy input values', () => {
  for (const permissions of [
    null,
    [],
    {},
    { rooms: ['room'], wildcard: true },
    { rooms: ['room', 'room'] },
    { rooms: [''] },
    { rooms: [' room'] },
    { rooms: ['bad\0id'] },
    { rooms: new Array<string>(1) },
    { rooms: Array.from({ length: 129 }, (_, i) => 'room-' + i) },
  ])
    assert.throws(() => createAgent({ ...base, permissions }, identity), /permission/i);
  const rooms = ['allowed'];
  const agent = createAgent({ ...base, permissions: { rooms } }, identity);
  rooms.length = 0;
  assert.deepEqual(agent.permissions, { rooms: ['allowed'] });
});

test('Room resource permissions guard start resume rebuild and late completion independently of membership', async () => {
  let agent = createAgent({ ...base, permissions: { rooms: ['allowed'] } }, identity);
  const store = new SqliteSessionStore(':memory:');
  let calls = 0,
    revoke = false;
  const run = async () => {
    calls++;
    if (revoke) agent = { ...agent, permissions: { rooms: [] } };
    return { sessionId: 'provider', text: 'safe' };
  };
  const manager = new LocalAgentRuntime(
    store,
    { list: () => [agent] },
    {
      get: (id: string) => ({
        id,
        title: id,
        type: 'agent',
        participants: [{ kind: 'agent', id: 'worker' }],
        activationPolicy: 'coordinator',
        taskId: null,
        createdAt: 'before',
        archivedAt: null,
      }),
    },
    { codex: run, claude: run },
    () => 'now',
    () => 'session',
  );
  try {
    await assert.rejects(
      manager.start({ agentId: 'worker', roomId: 'denied', message: 'read', instruction: '' }),
      /Room permission/,
    );
    assert.equal(calls, 0);
    assert.equal(store.list().length, 0);
    const started = await manager.start({
      agentId: 'worker',
      roomId: 'allowed',
      message: 'read',
      instruction: '',
    });
    assert.equal(started.text, 'safe');
    assert.equal(calls, 1);
    revoke = true;
    await assert.rejects(manager.resume(started.session.id), /Room permission/);
    const failed = store.get(started.session.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.providerSessionId, 'provider');
    assert.equal(calls, 2);
    await assert.rejects(manager.resume(failed.id), /Room permission/);
    assert.throws(() => manager.rebuild(failed.id, failed.version), /Room permission/);
    assert.equal(calls, 2);
    assert.deepEqual(store.get(failed.id), failed);
  } finally {
    await manager.shutdown();
    store.close();
  }
});

test('approved Room permission changes share capability CAS, preserve omitted policy and retain idempotent receipts after reopen', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { SqliteAgentRepository } = await import('../src/agents/sqlite.js');
  const { SqliteApprovalStore } = await import('../src/approvals/sqlite.js');
  const { requireApprovedPermission, createApprovalRequest } =
    await import('../src/approvals/domain.js');
  const home = mkdtempSync('/tmp/org-room-permission-cas-'),
    path = home + '/org.db';
  let agents = new SqliteAgentRepository(path),
    approvals = new SqliteApprovalStore(path);
  const actor = { kind: 'human' as const, id: 'founder' };
  try {
    agents.insert(createAgent({ ...base, permissions: { rooms: ['allowed'] } }, identity));
    const request = approvals.requestOnce(
      createApprovalRequest(
        {
          key: 'restrict',
          actor,
          taskId: null,
          eventId: null,
          operation: {
            kind: 'agent_capabilities',
            agentId: 'worker',
            expectedRevision: 0,
            capabilities: ['can_read'],
            permissions: { rooms: [] },
          },
        },
        { id: 'restrict', createdAt: 'before' },
      ),
    );
    assert.throws(
      () =>
        agents.applyCapabilities(
          requireApprovedPermission(approvals.get(request.id)),
          actor,
          'before',
        ),
      /approv/i,
    );
    approvals.decide(
      'restrict',
      { actor, decision: 'approve', reason: 'Bounded Room policy' },
      'approved',
    );
    const first = agents.applyCapabilities(
      requireApprovedPermission(approvals.get('restrict')),
      actor,
      'applied',
    );
    assert.deepEqual(first.permissions, { rooms: [] });
    assert.deepEqual(first.previousPermissions, { rooms: ['allowed'] });
    agents.close();
    approvals.close();
    agents = new SqliteAgentRepository(path);
    approvals = new SqliteApprovalStore(path);
    assert.deepEqual(agents.capabilitySnapshot('worker'), {
      agentId: 'worker',
      revision: 1,
      capabilities: ['can_read'],
      permissions: { rooms: [] },
    });
    assert.deepEqual(agents.list()[0]?.permissions, { rooms: [] });
    approvals.requestOnce(
      createApprovalRequest(
        {
          key: 'cap-only',
          actor,
          taskId: null,
          eventId: null,
          operation: {
            kind: 'agent_capabilities',
            agentId: 'worker',
            expectedRevision: 1,
            capabilities: ['can_read'],
          },
        },
        { id: 'cap-only', createdAt: 'before' },
      ),
    );
    approvals.decide(
      'cap-only',
      { actor, decision: 'approve', reason: 'Preserve Room restriction' },
      'approved',
    );
    const second = agents.applyCapabilities(
      requireApprovedPermission(approvals.get('cap-only')),
      actor,
      'applied',
    );
    assert.deepEqual(second.permissions, { rooms: [] });
    assert.deepEqual(
      agents.applyCapabilities(
        requireApprovedPermission(approvals.get('restrict')),
        actor,
        'retry',
      ),
      first,
    );
    assert.equal(agents.capabilitySnapshot('worker').revision, 2);
    assert.equal(agents.capabilityHistory('worker').length, 2);
    assert.deepEqual(agents.capabilityHistory('worker')[0], first);
  } finally {
    agents.close();
    approvals.close();
    rmSync(home, { recursive: true, force: true });
  }
});
