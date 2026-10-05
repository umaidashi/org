import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'bun:test';
test('normal CLI uses daemon for Agent Task Room and Event without opening client-selected DB', async () => {
  const home = mkdtempSync('/tmp/org-client-');
  const db = join(home, 'org.db');
  const socket = join(home, 'org.sock');
  const other = join(home, 'uncreated', 'other.db');
  const child = spawn(process.execPath, [
    '--no-env-file',
    cli,
    '--db',
    db,
    'daemon',
    '--socket',
    socket,
    '--poll-interval',
    '25',
  ]);
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', other, '--socket', socket, ...args],
      { encoding: 'utf8', timeout: 10_000 },
    );
  const json = (args: string[]): Record<string, unknown> => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(() => reject(new Error('Daemon not ready')), 5000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(stderr));
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.equal(
      run(['agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'codex']).status,
      0,
    );
    const agentsResult = run(['agent', 'list', '--json']);
    assert.equal(agentsResult.status, 0, agentsResult.stderr);
    const agents = JSON.parse(agentsResult.stdout) as { id: string; created_at: string }[];
    const agent = agents[0];
    assert.ok(agent);
    assert.equal(typeof agent.created_at, 'string');
    const duplicate = run(['agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'codex']);
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.stdout, '');
    const task = json(['task', 'create', '調査', '--objective', '調査完了']);
    assert.equal(json(['task', 'assign', String(task.id), '--owner', agent.id]).status, 'assigned');
    assert.equal(json(['task', 'get', String(task.id)]).id, task.id);
    const room = json([
      'room',
      'create',
      '相談',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      agent.id,
    ]);
    const message = json([
      'room',
      'send',
      String(room.id),
      '--human',
      'founder',
      '--content=--socket literal',
    ]);
    const history = run(['room', 'messages', String(room.id), '--json']);
    assert.equal(history.status, 0, history.stderr);
    assert.deepEqual(JSON.parse(history.stdout), [message]);
    const event = json([
      'event',
      'publish',
      'manual.requested',
      '--source',
      'human',
      '--payload',
      '{"task":"investigate"}',
    ]);
    assert.deepEqual(json(['event', 'get', String(event.id)]), event);
    const audit = run(['audit', 'list', '--json']);
    const logs = run(['logs', '--json']);
    assert.equal(logs.status, 0, logs.stderr);
    assert.equal(audit.status, 0, audit.stderr);
    assert.deepEqual(JSON.parse(logs.stdout), JSON.parse(audit.stdout));
    const malformed = run(['room', 'create', 'x', '--type', 'direct']);
    assert.equal(malformed.status, 2);
    assert.equal(existsSync(other), false);
    const rejected = await fetch('http://org.local/v1/command', {
      unix: socket,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ argv: ['--db', other, 'agent', 'list'] }),
    });
    const envelope = (await rejected.json()) as { code: number };
    assert.equal(envelope.code, 2);
    assert.equal(existsSync(other), false);
    const badBody = await fetch('http://org.local/v1/command', {
      unix: socket,
      method: 'POST',
      body: '{',
    });
    assert.equal(badBody.status, 400);
    const invalidShape = await fetch('http://org.local/v1/command', {
      unix: socket,
      method: 'POST',
      body: JSON.stringify({ argv: [1] }),
    });
    assert.equal(invalidShape.status, 400);
    for (const body of [
      { argv: ['agent', 'list'], db: other },
      { argv: Array.from({ length: 257 }, () => 'x') },
      { argv: ['x'.repeat(65537)] },
    ]) {
      const result = await fetch('http://org.local/v1/command', {
        unix: socket,
        method: 'POST',
        body: JSON.stringify(body),
      });
      assert.equal(result.status, 400);
    }
    const lifecycle = await fetch('http://org.local/v1/command', {
      unix: socket,
      method: 'POST',
      body: JSON.stringify({ argv: ['daemon', '--once'] }),
    });
    assert.equal(((await lifecycle.json()) as { code: number }).code, 2);
    const text = run(['agent', 'list']);
    assert.equal(text.status, 0);
    assert.match(text.stdout, /ID\tNAME\tROLE\tRUNTIME/);
    assert.equal(run(['daemon', 'stop']).status, 0);
    assert.equal(await exited, 0);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
test('normal CLI with unavailable daemon fails without creating DB and direct mode remains explicit', () => {
  const home = mkdtempSync('/tmp/org-client-missing-');
  const db = join(home, 'uncreated', 'org.db');
  try {
    const result = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'agent', 'list', '--json'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(existsSync(db), false);
    const direct = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, '--direct', 'agent', 'list', '--json'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(direct.status, 0, direct.stderr);
    assert.deepEqual(JSON.parse(direct.stdout), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('different database filenames in the same directory never silently share a daemon', async () => {
  const home = mkdtempSync('/tmp/org-client-db-');
  const first = join(home, 'first.db');
  const second = join(home, 'second.db');
  const child = spawn(process.execPath, ['--no-env-file', cli, '--db', first, 'daemon']);
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  child.stderr.resume();
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Daemon not ready')), 5000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Daemon exited ${code}`));
      });
    });
    const run = (db: string, args: string[]) =>
      spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
        encoding: 'utf8',
        timeout: 10_000,
      });
    assert.equal(
      run(first, ['agent', 'create', 'first', '--role', 'Chief', '--runtime', 'codex']).status,
      0,
    );
    const wrong = run(second, [
      'agent',
      'create',
      'second',
      '--role',
      'Chief',
      '--runtime',
      'codex',
    ]);
    assert.equal(wrong.status, 1, wrong.stderr);
    assert.equal(existsSync(second), false);
    const names = JSON.parse(run(first, ['agent', 'list', '--json']).stdout) as { name: string }[];
    assert.deepEqual(
      names.map((agent) => agent.name),
      ['first'],
    );
    assert.equal(run(first, ['daemon', 'stop']).status, 0);
    assert.equal(await exited, 0);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 15_000);
