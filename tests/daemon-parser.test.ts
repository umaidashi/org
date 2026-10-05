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
