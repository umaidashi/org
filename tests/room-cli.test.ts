import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';

test('malformed Room creation is rejected before creating a database or directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'org-room-invalid-'));
  const db = join(home, 'uncreated', 'org.db');
  try {
    for (const args of [
      ['room', 'create', 'x', '--type', 'direct'],
      ['room', 'create', 'x', '--type', 'task', '--human', 'founder'],
      ['room', 'create', 'x', '--type', 'direct', '--human', ' ', '--agent', 'chief'],
      [
        'room',
        'create',
        'x',
        '--type',
        'direct',
        '--human',
        'founder',
        '--human',
        'founder',
        '--agent',
        'chief',
      ],
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

test('multiple rooms with the same Agent keep separate persistent replies and archived histories', () => {
  const home = mkdtempSync(join(tmpdir(), 'org-room-e2e-'));
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', join(home, 'org.db'), ...args],
      {
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
  const json = (args: string[]): Record<string, unknown> => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  try {
    assert.equal(
      run(['agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'codex']).status,
      0,
    );
    const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const agent = agents[0]?.id;
    assert.ok(agent);
    const create = (title: string) =>
      json(['room', 'create', title, '--type', 'direct', '--human', 'founder', '--agent', agent]);
    const first = create('設計');
    const second = create('相談');
    assert.notEqual(first.id, second.id);
    assert.equal(first.activationPolicy, 'coordinator');
    assert.deepEqual(json(['room', 'get', String(first.id)]), first);
    const listed = run(['room', 'list', '--json']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal((JSON.parse(listed.stdout) as unknown[]).length, 2);
    assert.equal(
      run(['room', 'send', String(first.id), '--human', 'outsider', '--content', 'denied']).status,
      1,
    );
    assert.equal(
      run([
        'room',
        'send',
        String(first.id),
        '--human',
        'founder',
        '--content',
        'x',
        '--metadata',
        '[]',
      ]).status,
      2,
    );
    assert.equal(
      run([
        'room',
        'create',
        'unknown',
        '--type',
        'direct',
        '--human',
        'founder',
        '--agent',
        'unknown',
      ]).status,
      1,
    );
    const task = json(['task', 'create', '調査', '--objective', '調査完了']);
    const taskRoom = json([
      'room',
      'create',
      '調査会議',
      '--type',
      'task',
      '--task',
      String(task.id),
      '--agent',
      agent,
    ]);
    assert.equal(taskRoom.taskId, task.id);
    assert.equal(
      run([
        'room',
        'create',
        'unknown task',
        '--type',
        'task',
        '--task',
        'missing',
        '--agent',
        agent,
      ]).status,
      1,
    );
    assert.equal(
      run(['agent', 'create', 'dev', '--role', 'Developer', '--runtime', 'codex']).status,
      0,
    );
    const allAgents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const dev = allAgents.find((entry) => entry.id !== agent)?.id;
    assert.ok(dev);
    assert.equal(
      json([
        'room',
        'create',
        'group',
        '--type',
        'group',
        '--human',
        'founder',
        '--agent',
        agent,
        '--agent',
        dev,
        '--activation-policy',
        'mention_only',
      ]).activationPolicy,
      'mention_only',
    );
    assert.equal(
      json(['room', 'create', 'agents', '--type', 'agent', '--agent', agent, '--agent', dev]).type,
      'agent',
    );
    const message = json([
      'room',
      'send',
      String(first.id),
      '--human',
      'founder',
      '--content',
      '設計を確認',
      '--metadata',
      '{"topic":"design"}',
    ]);
    const reply = json([
      'room',
      'send',
      String(first.id),
      '--agent',
      agent,
      '--content',
      '確認済み',
      '--reply-to',
      String(message.id),
    ]);
    assert.equal(reply.replyTo, message.id);
    assert.equal(
      run([
        'room',
        'send',
        String(second.id),
        '--agent',
        agent,
        '--content',
        '不正返信',
        '--reply-to',
        String(message.id),
      ]).status,
      1,
    );
    assert.deepEqual(JSON.parse(run(['room', 'messages', String(first.id), '--json']).stdout), [
      message,
      reply,
    ]);
    assert.deepEqual(JSON.parse(run(['room', 'messages', String(second.id), '--json']).stdout), []);
    const archived = json(['room', 'archive', String(first.id)]);
    assert.equal(typeof archived.archivedAt, 'string');
    assert.deepEqual(json(['room', 'archive', String(first.id)]), archived);
    assert.equal(
      run(['room', 'send', String(first.id), '--human', 'founder', '--content', '追加']).status,
      1,
    );
    assert.deepEqual(JSON.parse(run(['room', 'messages', String(first.id), '--json']).stdout), [
      message,
      reply,
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
