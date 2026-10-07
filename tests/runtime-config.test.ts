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

test('Runtime Agent profiles copy isolated workspaces and env aliases and reject malformed or nested profiles', () => {
  const driver = { executable: '/tmp/runner', cwd: '/tmp/default', env: ['DEFAULT'] };
  const input = {
    codex: driver,
    agents: {
      alpha: {
        codex: { ...driver, cwd: '/tmp/alpha', env: { HOME: 'ALPHA_HOME', TOKEN: 'ALPHA_TOKEN' } },
      },
      beta: {
        claude: { ...driver, cwd: '/tmp/beta', env: { HOME: 'BETA_HOME', TOKEN: 'BETA_TOKEN' } },
      },
    },
  };
  const environment = {
    DEFAULT: 'default',
    ALPHA_HOME: '/tmp/alpha',
    ALPHA_TOKEN: 'fixture-alpha',
    BETA_HOME: '/tmp/beta',
    BETA_TOKEN: 'fixture-beta',
    UNSELECTED: 'excluded',
  };
  const config = parseRuntimeConfig(input, environment);
  assert.deepEqual(config.agents?.alpha?.codex?.env, {
    HOME: '/tmp/alpha',
    TOKEN: 'fixture-alpha',
  });
  assert.deepEqual(config.agents?.beta?.claude?.env, { HOME: '/tmp/beta', TOKEN: 'fixture-beta' });
  assert.deepEqual(config.codex?.env, { DEFAULT: 'default' });
  assert.equal(config.agents?.alpha?.codex?.cwd, '/tmp/alpha');
  input.agents.alpha.codex.env.HOME = 'BETA_HOME';
  assert.equal(config.agents?.alpha?.codex?.env.HOME, '/tmp/alpha');
  for (const agents of [
    null,
    [],
    { '': { codex: driver } },
    { alpha: {} },
    { alpha: { other: driver } },
    { alpha: { agents: {} } },
    { alpha: { codex: { ...driver, cwd: 'relative' } } },
  ])
    assert.throws(() => parseRuntimeConfig({ agents }, environment));
  for (const env of [
    { HOME: 'MISSING' },
    { 'BAD-NAME': 'DEFAULT' },
    { HOME: 'bad-source-name' },
    { HOME: 1 },
    null,
    [7],
  ])
    assert.throws(() => parseRuntimeConfig({ codex: { ...driver, env } }, environment));
});

test('Runtime env selection rejects inherited host properties', () => {
  const environment = {};
  Object.setPrototypeOf(environment, { MARKER: 'inherited' });
  assert.throws(() =>
    parseRuntimeConfig(
      { codex: { executable: '/tmp/runner', cwd: '/tmp/work', env: ['MARKER'] } },
      environment,
    ),
  );
  assert.throws(() =>
    parseRuntimeConfig(
      { codex: { executable: '/tmp/runner', cwd: '/tmp/work', env: ['constructor'] } },
      {},
    ),
  );
});
