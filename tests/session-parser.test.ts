import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseSessionCommand } from '../src/sessions/cli.js';
test('Session CLI requires explicit identity and messages and rejects conflicting options before storage', () => {
  const start = parseSessionCommand([
    'session',
    'start',
    '--agent',
    'a',
    '--room',
    'r',
    '--message',
    'work',
    '--json',
  ]);
  assert.equal(start.action, 'start');
  const resume = parseSessionCommand(['session', 'resume', 's']);
  assert.equal(resume.action, 'resume');
  for (const args of [
    ['session', 'start', '--agent', 'a'],
    ['session', 'send', 's'],
    ['session', 'stop', 's', '--message', 'x'],
    ['session', 'list', 's'],
    ['session', 'get', 's', '--agent', 'a'],
  ])
    assert.throws(() => parseSessionCommand(args));
});
