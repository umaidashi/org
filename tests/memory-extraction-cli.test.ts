import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cli } from './cli-path.js';

test('native CLI extracts original Agent Memory proposal once and preserves Room evidence and invalidation across reopen', () => {
  const home = mkdtempSync('/tmp/org-memory-extract-cli-');
  const run = (args: string[]) => {
    const p = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', home + '/org.db', ...args],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(p.status, 0, p.stderr);
    const value: unknown = JSON.parse(p.stdout);
    return value;
  };
  const id = (v: unknown): string => {
    assert.ok(v && typeof v === 'object' && 'id' in v && typeof v.id === 'string');
    return v.id;
  };
  try {
    const p = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        home + '/org.db',
        'agent',
        'create',
        'worker',
        '--role',
        'memory',
        '--runtime',
        'claude',
        '--capability',
        'can_read',
        '--capability',
        'can_write',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(p.status, 0, p.stderr);
    const agents = run(['agent', 'list', '--json']);
    assert.ok(Array.isArray(agents));
    const agentId = id(agents[0]);
    const roomId = id(
      run([
        'room',
        'create',
        'work',
        '--type',
        'direct',
        '--human',
        'founder',
        '--agent',
        agentId,
        '--json',
      ]),
    );
    const sourceId = id(
      run([
        'room',
        'send',
        roomId,
        '--human',
        'founder',
        '--content',
        '小さなテストを先に実行する',
        '--json',
      ]),
    );
    const proposalId = id(
      run([
        'room',
        'send',
        roomId,
        '--agent',
        agentId,
        '--content',
        JSON.stringify({
          version: 1,
          tool: 'memory',
          candidates: [
            {
              type: 'procedural',
              content: '小さなテストを先に実行する',
              confidence: 1,
              tags: ['testing'],
              entities: ['org'],
              importance: 0.9,
              sourceMessageIds: [sourceId],
            },
          ],
        }),
        '--json',
      ]),
    );
    const args = ['memory', 'extract', '--room', roomId, '--message', proposalId, '--json'];
    const first = run(args);
    assert.ok(Array.isArray(first));
    assert.equal(first.length, 1);
    const memoryId = id(first[0]);
    assert.deepEqual(first[0].tags, ['testing']);
    assert.deepEqual(first[0].entities, ['org']);
    assert.equal(first[0].importance, 0.9);
    assert.deepEqual(run(['memory', 'get', memoryId, '--json']), first[0]);
    assert.deepEqual(run(args), first);
    const duplicateId = id(
      run([
        'room',
        'send',
        roomId,
        '--agent',
        agentId,
        '--content',
        JSON.stringify({
          version: 1,
          tool: 'memory',
          candidates: [
            {
              type: 'procedural',
              content: '小さなテストを先に実行する',
              confidence: 1,
              tags: ['testing'],
              entities: ['org'],
              importance: 0.9,
              sourceMessageIds: [sourceId],
            },
          ],
        }),
        '--json',
      ]),
    );
    const duplicate = run([
      'memory',
      'extract',
      '--room',
      roomId,
      '--message',
      duplicateId,
      '--json',
    ]);
    assert.ok(Array.isArray(duplicate));
    assert.equal(id(duplicate[0]), memoryId);
    run(['memory', 'invalidate', memoryId, '--reason', 'changed', '--json']);
    const repeated = run(args);
    assert.ok(Array.isArray(repeated));
    assert.ok(repeated[0] && typeof repeated[0] === 'object' && 'status' in repeated[0]);
    assert.equal(repeated[0].status, 'invalidated');
    const messages = run(['room', 'messages', roomId, '--json']);
    assert.ok(Array.isArray(messages));
    assert.equal(messages.length, 3);
    const memories = run(['memory', 'list', '--scope', 'room:' + roomId, '--json']);
    assert.ok(Array.isArray(memories));
    assert.equal(memories.length, 1);
    const previousId = id(
      run([
        'memory',
        'capture',
        '--type',
        'procedural',
        '--scope',
        'room:' + roomId,
        '--content',
        '変更後は全テストも実行する',
        '--confidence',
        '1',
        '--room',
        roomId,
        '--message',
        sourceId,
        '--json',
      ]),
    );
    const changedId = id(
      run([
        'room',
        'send',
        roomId,
        '--human',
        'founder',
        '--content',
        '変更後は全テストも実行する',
        '--json',
      ]),
    );
    const replacementProposal = id(
      run([
        'room',
        'send',
        roomId,
        '--agent',
        agentId,
        '--content',
        JSON.stringify({
          version: 1,
          tool: 'memory',
          candidates: [
            {
              type: 'procedural',
              content: '変更後は全テストも実行する',
              confidence: 1,
              sourceMessageIds: [changedId],
              supersedes: previousId,
              tags: ['regression'],
              entities: ['org'],
              importance: 1,
            },
          ],
        }),
        '--json',
      ]),
    );
    const replacementArgs = [
      'memory',
      'extract',
      '--room',
      roomId,
      '--message',
      replacementProposal,
      '--json',
    ];
    const replaced = run(replacementArgs);
    assert.ok(Array.isArray(replaced));
    assert.equal(replaced.length, 1);
    assert.deepEqual(replaced[0].tags, ['regression']);
    assert.deepEqual(replaced[0].entities, ['org']);
    assert.equal(replaced[0].importance, 1);
    assert.deepEqual(run(['memory', 'get', id(replaced[0]), '--json']), replaced[0]);
    assert.deepEqual(run(replacementArgs), replaced);
    const previous = run(['memory', 'get', previousId, '--json']);
    assert.ok(previous && typeof previous === 'object' && 'status' in previous);
    assert.equal(previous.status, 'superseded');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
