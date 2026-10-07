import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';

test('events persist without recipients and subscriptions match independently across CLI processes', () => {
  const home = mkdtempSync(join(tmpdir(), 'org-event-e2e-'));
  const db = join(home, 'org.db');
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
    });
  const json = (args: string[]): Record<string, unknown> => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  try {
    const event = json([
      'event',
      'publish',
      'github.pr.opened',
      '--source',
      'manual',
      '--payload',
      '{"repo":"example","number":42}',
    ]);
    assert.deepEqual(json(['event', 'get', String(event.id)]), event);
    assert.deepEqual(JSON.parse(run(['event', 'matches', String(event.id), '--json']).stdout), []);
    assert.equal(
      run(['agent', 'create', 'reviewer', '--role', 'Reviewer', '--runtime', 'codex']).status,
      0,
    );
    const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const agent = agents[0]?.id;
    assert.ok(agent);
    const subscription = json([
      'event',
      'subscribe',
      'github.*.opened',
      '--subscriber-type',
      'agent',
      '--subscriber',
      agent,
      '--filter',
      '{"repo":"example"}',
    ]);
    assert.deepEqual(JSON.parse(run(['event', 'matches', String(event.id), '--json']).stdout), [
      subscription,
    ]);
    const other = json([
      'event',
      'publish',
      'github.pr.opened',
      '--source',
      'manual',
      '--payload',
      '{"repo":"other"}',
    ]);
    assert.deepEqual(JSON.parse(run(['event', 'matches', String(other.id), '--json']).stdout), []);
    assert.equal(json(['event', 'disable', String(subscription.id)]).enabled, false);
    assert.deepEqual(JSON.parse(run(['event', 'matches', String(event.id), '--json']).stdout), []);
    assert.equal(json(['event', 'enable', String(subscription.id)]).enabled, true);
    assert.equal((JSON.parse(run(['event', 'list', '--json']).stdout) as unknown[]).length, 2);
    assert.deepEqual(json(['event', 'get', String(event.id)]), event);
    const audit = run(['audit', 'list', '--json']);
    assert.equal(audit.status, 0, audit.stderr);
    const entries = JSON.parse(audit.stdout) as { tool: string; actor: unknown }[];
    const operations = entries.filter(
      (entry) => entry.tool === 'event.publish' || entry.tool.startsWith('subscription.'),
    );
    assert.deepEqual(
      operations.map((entry) => entry.tool),
      [
        'event.publish',
        'subscription.create',
        'event.publish',
        'subscription.disable',
        'subscription.enable',
      ],
    );
    assert.ok(
      operations.every(
        (entry) =>
          JSON.stringify(entry.actor) === JSON.stringify({ kind: 'system', id: 'local-host' }),
      ),
    );
    assert.equal(json(['event', 'enable', String(subscription.id)]).enabled, true);
    assert.equal(run(['audit', 'list', '--json']).stdout, audit.stdout);
    assert.equal(
      run([
        'event',
        'subscribe',
        'github.**',
        '--subscriber-type',
        'agent',
        '--subscriber',
        'unknown',
      ]).status,
      1,
    );
    assert.equal(
      json([
        'event',
        'subscribe',
        'workflow.**',
        '--subscriber-type',
        'workflow',
        '--subscriber',
        'external-flow',
      ]).subscriberType,
      'workflow',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('malformed event inputs return usage error before creating a database', () => {
  const home = mkdtempSync(join(tmpdir(), 'org-event-invalid-'));
  const db = join(home, 'uncreated', 'org.db');
  try {
    for (const args of [
      ['event', 'publish', 'github..opened', '--source', 'manual'],
      ['event', 'publish', 'github.opened', '--source', 'manual', '--payload', '[]'],
      ['event', 'subscribe', 'github.**.opened', '--subscriber-type', 'agent', '--subscriber', 'a'],
      ['event', 'subscribe', 'github.*', '--subscriber-type', 'other', '--subscriber', 'a'],
    ]) {
      const result = spawnSync(
        process.execPath,
        ['--no-env-file', cli, '--direct', '--db', db, ...args],
        {
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.equal(existsSync(join(home, 'uncreated')), false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
