import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('Memory CLI captures evidence, supersedes without altering history, and persists invalidation', () => {
  const home = mkdtempSync('/tmp/org-memory-cli-');
  const db = join(home, 'org.db');
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  const json = (args: string[]): unknown => {
    const p = run([...args, '--json']);
    assert.equal(p.status, 0, p.stderr);
    return JSON.parse(p.stdout);
  };
  try {
    assert.equal(
      run(['agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'codex']).status,
      0,
    );
    const agents = json(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const agent: unknown = agents[0];
    assert.ok(
      agent !== null && typeof agent === 'object' && 'id' in agent && typeof agent.id === 'string',
    );
    const room = json([
      'room',
      'create',
      'work',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      agent.id,
    ]);
    assert.ok(
      room !== null && typeof room === 'object' && 'id' in room && typeof room.id === 'string',
    );
    const source = json([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'Decision source',
    ]);
    assert.ok(
      source !== null &&
        typeof source === 'object' &&
        'id' in source &&
        typeof source.id === 'string',
    );
    const capture = [
      'memory',
      'capture',
      '--type',
      'semantic',
      '--scope',
      'room:' + room.id,
      '--room',
      room.id,
      '--message',
      source.id,
      '--confidence',
      '0.8',
      '--content',
      'old',
    ];
    const first = json(capture);
    assert.ok(
      first !== null && typeof first === 'object' && 'id' in first && typeof first.id === 'string',
    );
    const second = json([...capture.slice(0, -1), 'new', '--supersedes', first.id]);
    assert.ok(
      second !== null &&
        typeof second === 'object' &&
        'id' in second &&
        typeof second.id === 'string',
    );
    const previous = json(['memory', 'get', first.id]);
    assert.ok(
      previous !== null &&
        typeof previous === 'object' &&
        'status' in previous &&
        'content' in previous,
    );
    assert.equal(previous.status, 'superseded');
    assert.equal(previous.content, 'old');
    const invalid = json(['memory', 'invalidate', second.id, '--reason', 'obsolete']);
    assert.ok(invalid !== null && typeof invalid === 'object' && 'status' in invalid);
    assert.equal(invalid.status, 'invalidated');
    const list = json(['memory', 'list', '--scope', 'room:' + room.id]);
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 2);
    const messages = json(['room', 'messages', room.id]);
    assert.ok(Array.isArray(messages));
    assert.equal(messages.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
