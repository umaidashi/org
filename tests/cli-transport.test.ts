import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseTransport } from '../src/application/transport.js';
import { parseCommandResult } from '../src/application/port.js';
test('transport extracts global options without removing option-like data or escaped positional values', () => {
  const parsed = parseTransport([
    '--db',
    '/tmp/client.db',
    '--socket=/tmp/server.sock',
    'room',
    'send',
    'r',
    '--content=--socket literal',
  ]);
  assert.equal(parsed.socket, '/tmp/server.sock');
  assert.deepEqual(parsed.argv, ['room', 'send', 'r', '--content=--socket literal']);
  assert.deepEqual(parseTransport(['--direct', 'task', 'create', '--', '--socket']).argv, [
    'task',
    'create',
    '--',
    '--socket',
  ]);
  assert.throws(() => parseTransport(['--direct', '--socket', '/tmp/sock', 'agent', 'list']));
  assert.throws(() => parseTransport(['--db', '/tmp/a', '--db', '/tmp/b', 'agent', 'list']));
});
test('command client rejects malformed or incomplete success envelopes', () => {
  const valid = { code: 0, stdout: ['[]'], stderr: [] };
  assert.deepEqual(parseCommandResult(valid), valid);
  for (const invalid of [
    null,
    {},
    { code: 3, stdout: [], stderr: [] },
    { code: 0, stdout: [42], stderr: [] },
    { code: 0, stdout: [] },
    { code: 0, stdout: [], stderr: 'error' },
  ])
    assert.throws(() => parseCommandResult(invalid));
});
