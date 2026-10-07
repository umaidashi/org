import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { saveSandboxArtifact } from '../src/sandbox/artifact.js';
test('Memory CLI captures evidence, supersedes without altering history, and persists invalidation', async () => {
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
    const uncreated = join(home, 'uncreated', 'org.db');
    const invalidSource = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        uncreated,
        'memory',
        'capture',
        '--type',
        'episodic',
        '--scope',
        'global',
        '--content',
        'fact',
        '--confidence',
        '1',
        '--source-review',
        'https://example.invalid/review',
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(invalidSource.status, 2, invalidSource.stderr);
    assert.equal(existsSync(join(home, 'uncreated')), false);
    for (const sourceOptions of [
      ['--source-event', ' '],
      ['--source-event', 'event', '--source-review', 'org://tasks/task/reviews/review'],
      ['--source-review', 'org://events/event'],
      ['--source-artifact', 'https://example.invalid/artifact'],
      ['--source-artifact', 'org://artifacts/' + 'A'.repeat(64)],
    ]) {
      const invalid = spawnSync(
        process.execPath,
        [
          '--no-env-file',
          cli,
          '--direct',
          '--db',
          uncreated,
          'memory',
          'capture',
          '--type',
          'episodic',
          '--scope',
          'company',
          '--content',
          'fact',
          '--confidence',
          '1',
          ...sourceOptions,
        ],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(invalid.status, 2, invalid.stderr);
      assert.equal(existsSync(join(home, 'uncreated')), false);
    }
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
    const records = json(['audit', 'list']);
    assert.ok(Array.isArray(records));
    const mutations = records.filter((entry) => entry.tool.startsWith('memory.'));
    assert.deepEqual(
      mutations.map((entry) => String(entry.tool)),
      ['memory.capture', 'memory.supersede', 'memory.invalidate'],
    );
    for (const entry of mutations) {
      assert.deepEqual(entry.actor, { kind: 'system', id: 'local-host' });
      assert.equal(entry.result, 'succeeded');
      assert.ok(entry.inputRef.startsWith('org://memories/'));
      assert.ok(entry.outputRef.startsWith('org://memories/'));
    }
    assert.deepEqual(json(['audit', 'list']), records);

    const list = json(['memory', 'list', '--scope', 'room:' + room.id]);
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 2);
    const bounded = json([
      ...capture.slice(0, -1),
      'temporary',
      '--tag',
      'database',
      '--tag',
      '日本語',
      '--entity',
      'org',
      '--importance',
      '0.9',
      '--valid-from',
      '2026-01-01T00:00:00.000Z',
      '--valid-until',
      '2027-01-01T00:00:00.000Z',
    ]);
    assert.ok(
      bounded !== null &&
        typeof bounded === 'object' &&
        'id' in bounded &&
        typeof bounded.id === 'string',
    );
    assert.deepEqual(json(['memory', 'get', bounded.id]), bounded);
    assert.deepEqual(
      json(['memory', 'list', '--type', 'semantic', '--tag', 'database', '--entity', 'org']),
      [bounded],
    );
    assert.deepEqual(json(['memory', 'list', '--type', 'procedural', '--tag', 'database']), []);
    assert.equal(run([...capture, '--importance', 'NaN']).status, 2);
    assert.equal(run([...capture, '--tag', 'duplicate', '--tag', 'duplicate']).status, 2);
    assert.deepEqual(
      json(['memory', 'list', '--scope', 'room:' + room.id, '--at', '2026-06-01T00:00:00.000Z']),
      [bounded],
    );
    assert.deepEqual(
      json(['memory', 'list', '--scope', 'room:' + room.id, '--at', '2027-01-01T00:00:00.000Z']),
      [],
    );
    assert.deepEqual(
      json(['memory', 'list', '--scope', 'room:' + room.id, '--at', '2025-01-01T00:00:00.000Z']),
      [],
    );
    assert.equal(run([...capture, '--valid-from', '2026-02-31T00:00:00.000Z']).status, 2);
    assert.deepEqual(
      json([
        'memory',
        'search',
        'temporary',
        '--scope',
        'room:' + room.id,
        '--tag',
        'database',
        '--at',
        '2026-06-01T00:00:00.000Z',
      ]),
      [bounded],
    );
    assert.deepEqual(
      json(['memory', 'search', 'temporary', '--at', '2027-01-01T00:00:00.000Z']),
      [],
    );
    assert.deepEqual(
      json([
        'memory',
        'search',
        'temporary',
        '--scope',
        'room:foreign',
        '--at',
        '2026-06-01T00:00:00.000Z',
      ]),
      [],
    );
    assert.equal(run(['memory', 'search', 'ab']).status, 2);
    json(['memory', 'invalidate', bounded.id, '--reason', 'search proof complete']);
    assert.deepEqual(
      json(['memory', 'search', 'temporary', '--at', '2026-06-01T00:00:00.000Z']),
      [],
    );
    const bytes = Buffer.from('owned original Artifact');
    const artifactUri = await saveSandboxArtifact(db + '.artifacts', bytes);
    const artifactPath = join(db + '.artifacts', artifactUri.slice('org://artifacts/'.length));
    const artifactCapture = [
      'memory',
      'capture',
      '--type',
      'episodic',
      '--scope',
      'company',
      '--content',
      'Artifact observed',
      '--confidence',
      '1',
      '--source-artifact',
      artifactUri,
    ];
    const artifactMemory = json(artifactCapture);
    assert.ok(
      artifactMemory !== null &&
        typeof artifactMemory === 'object' &&
        'id' in artifactMemory &&
        typeof artifactMemory.id === 'string' &&
        'sourceRefs' in artifactMemory,
    );
    assert.deepEqual(artifactMemory.sourceRefs, [{ uri: artifactUri }]);
    assert.deepEqual(json(['memory', 'get', artifactMemory.id]), artifactMemory);
    assert.deepEqual(readFileSync(artifactPath), bytes);
    const beforeBadArtifact = json(['memory', 'list']);
    writeFileSync(join(db + '.artifacts', '0'.repeat(64)), 'corrupt');
    symlinkSync(artifactPath, join(db + '.artifacts', '1'.repeat(64)));
    for (const digest of ['0'.repeat(64), '1'.repeat(64), '2'.repeat(64)])
      assert.equal(run([...artifactCapture.slice(0, -1), 'org://artifacts/' + digest]).status, 1);
    for (const extra of [
      ['--source-event', 'event'],
      ['--source-review', 'org://tasks/t/reviews/r'],
      ['--room', room.id, '--message', source.id],
    ])
      assert.equal(run([...artifactCapture, ...extra]).status, 2);
    assert.deepEqual(json(['memory', 'list']), beforeBadArtifact);
    assert.deepEqual(readFileSync(artifactPath), bytes);
    const event = json(['event', 'publish', 'task.completed', '--source', 'test']);
    assert.ok(
      event !== null && typeof event === 'object' && 'id' in event && typeof event.id === 'string',
    );
    const eventCapture = [
      'memory',
      'capture',
      '--type',
      'episodic',
      '--scope',
      'company',
      '--content',
      'Event observed',
      '--confidence',
      '1',
      '--source-event',
      event.id,
    ];
    const fromEvent = json(eventCapture);
    assert.ok(
      fromEvent !== null &&
        typeof fromEvent === 'object' &&
        'id' in fromEvent &&
        typeof fromEvent.id === 'string' &&
        'sourceRefs' in fromEvent,
    );
    assert.deepEqual(fromEvent.sourceRefs, [
      { uri: 'org://events/' + encodeURIComponent(event.id) },
    ]);
    assert.deepEqual(json(['memory', 'get', fromEvent.id]), fromEvent);
    assert.deepEqual(json(['event', 'list']), [event]);
    const memoriesBefore = json(['memory', 'list']);
    assert.equal(run([...eventCapture.slice(0, -1), 'absent']).status, 1);
    assert.equal(
      run([...eventCapture, '--source-review', 'org://tasks/task/reviews/review']).status,
      2,
    );
    assert.equal(run([...eventCapture, '--room', room.id, '--message', source.id]).status, 2);
    assert.equal(run([...eventCapture.slice(0, -1), ' ']).status, 2);
    assert.deepEqual(json(['memory', 'list']), memoriesBefore);
    const messages = json(['room', 'messages', room.id]);
    assert.ok(Array.isArray(messages));
    assert.equal(messages.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
