import { SqliteEventBus } from '../src/events/sqlite.js';
import { invokeWorkflow, observeWorkflow } from '../src/workflows/service.js';
import { saveSandboxArtifact } from '../src/sandbox/artifact.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cli } from './cli-path.js';

test('native CLI extracts original Agent Memory proposal once and preserves Room evidence and invalidation across reopen', async () => {
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
    const eventId = id(
      run(['event', 'publish', 'fixture.observed', '--source', 'fixture', '--json']),
    );
    const eventUri = 'org://events/' + encodeURIComponent(eventId);
    const artifactUri = await saveSandboxArtifact(
      home + '/org.db.artifacts',
      Buffer.from('original evidence'),
    );
    const approvalId = id(
      run([
        'approval',
        'request',
        agentId,
        '--key',
        'evidence',
        '--actor',
        'founder',
        '--expected-revision',
        '0',
        '--capability',
        'can_read',
        '--json',
      ]),
    );
    run([
      'approval',
      'decide',
      approvalId,
      '--actor',
      'founder',
      '--decision',
      'reject',
      '--reason',
      'Fixture decision',
      '--json',
    ]);
    const originalDecision = run(['approval', 'get', approvalId, '--json']);
    const decisionUri = 'org://approvals/' + encodeURIComponent(approvalId) + '/decision';
    const bus = new SqliteEventBus(home + '/org.db');
    let workflowUri: string;
    try {
      await invokeWorkflow(
        bus,
        { invoke: async () => 'execution' },
        {
          workflowId: 'workflow',
          host: 'http://fixture.invalid',
          input: {},
          inputDigest: 'a'.repeat(64),
        },
        { id: 'workflow-request', createdAt: '2026-10-01T00:00:00.000Z' },
        () => '2026-10-01T00:00:01.000Z',
      );
      const observed = await observeWorkflow(
        bus,
        {
          status: async () => ({ id: 'execution', workflowId: 'workflow', status: 'success' }),
          cancel: async () => 'canceled',
        },
        'workflow-request',
        'http://fixture.invalid',
        'status',
        { id: 'workflow-observed', createdAt: '2026-10-01T00:00:02.000Z' },
      );
      workflowUri = 'org://events/' + encodeURIComponent(observed.id);
    } finally {
      bus.close();
    }
    const originalEvents = run(['event', 'list', '--json']);
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
              sourceUris: [eventUri, artifactUri, decisionUri, workflowUri],
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
    assert.deepEqual(first[0].sourceRefs, [
      { roomId, messageId: sourceId },
      { roomId, messageId: proposalId },
      { uri: eventUri },
      { uri: artifactUri },
      { uri: decisionUri },
      { uri: workflowUri },
    ]);
    assert.deepEqual(run(['memory', 'get', memoryId, '--json']), first[0]);
    assert.deepEqual(run(args), first);
    assert.deepEqual(run(['approval', 'get', approvalId, '--json']), originalDecision);
    assert.deepEqual(run(['event', 'list', '--json']), originalEvents);
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
    const beforeFailure = run(['memory', 'list', '--scope', 'room:' + roomId, '--json']);
    const badProposal = id(
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
              type: 'episodic',
              content: 'must not be saved',
              confidence: 1,
              sourceMessageIds: [sourceId],
              sourceUris: [artifactUri],
            },
            {
              type: 'episodic',
              content: 'missing evidence',
              confidence: 1,
              sourceMessageIds: [sourceId],
              sourceUris: ['org://events/absent'],
            },
          ],
        }),
        '--json',
      ]),
    );
    const failed = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        home + '/org.db',
        'memory',
        'extract',
        '--room',
        roomId,
        '--message',
        badProposal,
        '--json',
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /Event.*not found/);
    assert.deepEqual(run(['memory', 'list', '--scope', 'room:' + roomId, '--json']), beforeFailure);
    assert.deepEqual(run(['event', 'list', '--json']), originalEvents);
    assert.deepEqual(run(['approval', 'get', approvalId, '--json']), originalDecision);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
