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
