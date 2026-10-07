import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseDaemonCommand } from '../src/daemon/cli.js';
test('socket flags cannot silently target a different database in once mode', () => {
  assert.throws(
    () => parseDaemonCommand(['daemon', '--once', '--socket', '/tmp/other.sock']),
    /socket/,
  );
  const db = `/tmp/${'nested/'.repeat(30)}org.db`;
  assert.equal(parseDaemonCommand(['daemon', '--once', '--db', db]).action, 'once');
  assert.throws(() => parseDaemonCommand(['daemon', '--socket', `${db}.sock`]), /100 bytes/);
});
test('automatic wake-up is opt-in and requires a configured continuous daemon', () => {
  assert.equal(parseDaemonCommand(['daemon']).wakeUp, false);
  for (const args of [
    ['daemon', '--wake-up'],
    ['daemon', '--wake-up', '--once', '--runtime-config', '/tmp/runtime.json'],
    ['daemon', 'status', '--wake-up', '--runtime-config', '/tmp/runtime.json'],
  ])
    assert.throws(() => parseDaemonCommand(args));
  assert.equal(
    parseDaemonCommand(['daemon', '--wake-up', '--runtime-config', '/tmp/runtime.json']).wakeUp,
    true,
  );
  assert.equal(parseDaemonCommand(['daemon', 'wakeups']).socketClient, true);
});
test('daemon Sandbox host policy is explicit and requires continuous configured Runtime', () => {
  const result = parseDaemonCommand([
    'daemon',
    '--runtime-config',
    '/tmp/runtime.json',
    '--sandbox-config',
    '/tmp/sandbox.json',
  ]);
  assert.equal(result.sandboxConfig, '/tmp/sandbox.json');
  for (const args of [
    ['daemon', '--sandbox-config', '/tmp/policy.json'],
    ['daemon', '--runtime-config', '/tmp/runtime.json', '--sandbox-config', ''],
    [
      'daemon',
      '--once',
      '--runtime-config',
      '/tmp/runtime.json',
      '--sandbox-config',
      '/tmp/policy.json',
    ],
  ])
    assert.throws(() => parseDaemonCommand(args));
});

test('daemon Workflow host config enables continuous Workflow polling without Agent credentials', () => {
  assert.equal(
    parseDaemonCommand(['daemon', '--workflow-config', '/tmp/workflow.json']).workflowConfig,
    '/tmp/workflow.json',
  );
  for (const args of [
    ['daemon', '--workflow-config', ''],
    ['daemon', '--once', '--workflow-config', '/tmp/workflow.json'],
    ['daemon', 'status', '--workflow-config', '/tmp/workflow.json'],
  ])
    assert.throws(() => parseDaemonCommand(args));
});

test('automatic delegation Room allowlist requires configured continuous wake-up and rejects invalid IDs', () => {
  const base = ['daemon', '--runtime-config', '/tmp/runtime.json', '--wake-up'];
  assert.deepEqual(parseDaemonCommand([...base, '--delegation-room', 'r']).delegationRooms, ['r']);
  for (const args of [
    ['daemon', '--delegation-room', 'r'],
    [...base, '--once', '--delegation-room', 'r'],
    [...base, '--delegation-room', 'r', '--delegation-room', 'r'],
    [...base, '--delegation-room', '  '],
    [...base, '--delegation-room', 'r\0'],
    [...base, '--delegation-room', 'x'.repeat(129)],
  ])
    assert.throws(() => parseDaemonCommand(args));
});

test('Memory extraction Room opt-in rejects duplicate or malformed IDs and requires continuous wake-up', () => {
  const base = ['daemon', '--wake-up', '--runtime-config', '/tmp/config.json'];
  assert.deepEqual(parseDaemonCommand([...base, '--memory-extraction-room', 'r']).extractionRooms, [
    'r',
  ]);
  for (const args of [
    ['daemon', '--memory-extraction-room', 'r'],
    [...base, '--once', '--memory-extraction-room', 'r'],
    [...base, '--memory-extraction-room', 'r', '--memory-extraction-room', 'r'],
    [...base, '--memory-extraction-room', ' '],
    [...base, '--memory-extraction-room', 'x'.repeat(129)],
  ])
    assert.throws(() => parseDaemonCommand(args));
});

test('Workflow status observation opt-in requires configured continuous mode', () => {
  assert.equal(
    parseDaemonCommand(['daemon', '--workflow-config', '/tmp/workflow.json', '--observe-workflows'])
      .observeWorkflows,
    true,
  );
  assert.equal(parseDaemonCommand(['daemon']).observeWorkflows, false);
  for (const args of [
    ['daemon', '--observe-workflows'],
    ['daemon', '--once', '--observe-workflows'],
    ['daemon', 'status', '--workflow-config', '/tmp/workflow.json', '--observe-workflows'],
  ])
    assert.throws(() => parseDaemonCommand(args));
});

test('Runtime Linear proposals require explicit configured continuous opt-in', () => {
  assert.equal(parseDaemonCommand(['daemon']).linearUpdates, false);
  assert.equal(
    parseDaemonCommand(['daemon', '--runtime-config', '/tmp/runtime.json', '--linear-updates'])
      .linearUpdates,
    true,
  );
  for (const args of [
    ['daemon', '--linear-updates'],
    ['daemon', '--once', '--linear-updates', '--runtime-config', '/tmp/runtime.json'],
    ['daemon', 'status', '--linear-updates', '--runtime-config', '/tmp/runtime.json'],
  ])
    assert.throws(() => parseDaemonCommand(args));
});
