import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseRuntimeConfig } from '../src/runtime/config.js';
test('Runtime config admits explicit executable/workspace and selects only named environment values', () => {
  const entry = { executable: '/tmp/runner', cwd: '/tmp/work', env: ['ORG_MARKER'] };
  const config = parseRuntimeConfig(
    { codex: entry },
    { ORG_MARKER: 'explicit', UNSELECTED: 'excluded' },
  );
  assert.deepEqual(config.codex?.env, { ORG_MARKER: 'explicit' });
  for (const invalid of [
    null,
    { other: entry },
    { codex: {} },
    { codex: { ...entry, executable: 'relative' } },
    { codex: { ...entry, env: ['MISSING'] } },
    { codex: { ...entry, env: { ORG_MARKER: 'literal' } } },
    { codex: { ...entry, timeoutMs: 0 } },
    { codex: { ...entry, maxOutputBytes: -1 } },
    { codex: { ...entry, executable: '/tmp/runner\0bad' } },
  ])
    assert.throws(() => parseRuntimeConfig(invalid, { ORG_MARKER: 'explicit' }));
});
