import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('Room CLI persists coordinator and selects mention or A2A targets across daemon and legacy reopening', async () => {
  const home = mkdtempSync('/tmp/org-activation-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        ...(args.includes('--direct') ? [] : ['--socket', socket]),
        ...args,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
  const daemon = spawn(process.execPath, [
    '--no-env-file',
    cli,
    '--db',
    db,
    'daemon',
    '--socket',
    socket,
  ]);
  const exited = new Promise((resolve) => daemon.once('exit', resolve));
  let error = '';
  daemon.stderr.on('data', (value: Buffer) => {
    error += value.toString();
  });
  const json = (args: string[]): unknown => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const entity = (args: string[]): Record<string, unknown> & { id: string } => {
    const value = json(args);
    assert.ok(record(value) && typeof value.id === 'string');
    return { ...value, id: value.id };
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready: ' + error)), 5000);
      daemon.stdout.on('data', (value: Buffer) => {
        if (value.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    for (const name of ['chief', 'cto'])
      assert.equal(run(['agent', 'create', name, '--role', name, '--runtime', 'claude']).status, 0);
    const agents = json(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const agentId = (name: string) => {
      const value: unknown = agents.find((a: unknown) => record(a) && a.name === name);
      assert.ok(record(value) && typeof value.id === 'string');
      return value.id;
    };
    const chief = agentId('chief'),
      cto = agentId('cto');
    const room = entity([
      'room',
      'create',
      'Company',
      '--type',
      'group',
      '--human',
      'founder',
      '--agent',
      chief,
      '--agent',
      cto,
      '--coordinator',
      chief,
    ]);
    assert.equal(room.coordinatorId, chief);
    const source = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'Research']);
    assert.deepEqual(json(['room', 'targets', room.id, '--message', source.id]), [chief]);
    const mentioned = entity([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'Ask CTO',
      '--mention',
      cto,
    ]);
    assert.deepEqual(json(['room', 'targets', room.id, '--message', mentioned.id]), [cto]);
    const before = json(['room', 'messages', room.id]);
    assert.equal(
      run(['room', 'send', room.id, '--human', 'founder', '--content', 'x', '--mention', 'missing'])
        .status,
      1,
    );
    assert.deepEqual(json(['room', 'messages', room.id]), before);
    const a2a = entity([
      'a2a',
      'send',
      room.id,
      '--from',
      chief,
      '--to',
      cto,
      '--type',
      'request',
      '--payload',
      '{}',
    ]);
    assert.deepEqual(json(['room', 'targets', room.id, '--message', a2a.id]), [cto]);
    const reply = entity([
      'room',
      'send',
      room.id,
      '--agent',
      chief,
      '--content',
      'Answer',
      '--reply-to',
      source.id,
    ]);
    assert.deepEqual(json(['room', 'targets', room.id, '--message', reply.id]), []);
    assert.deepEqual(json(['--direct', 'room', 'get', room.id]), room);
    assert.equal(
      run([
        'room',
        'create',
        'Invalid',
        '--type',
        'group',
        '--human',
        'founder',
        '--agent',
        chief,
        '--agent',
        cto,
        '--coordinator',
        'founder',
      ]).status,
      2,
    );
    const legacy = entity([
      'room',
      'create',
      'Legacy',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      chief,
    ]);
    assert.equal(legacy.coordinatorId, undefined);
    const legacySource = entity([
      'room',
      'send',
      legacy.id,
      '--human',
      'founder',
      '--content',
      'Hello',
    ]);
    assert.deepEqual(
      json(['--direct', 'room', 'targets', legacy.id, '--message', legacySource.id]),
      [chief],
    );
    assert.equal(run(['room', 'targets', legacy.id, '--message', source.id]).status, 1);
    assert.equal(run(['room', 'archive', room.id]).status, 0);
    assert.equal(run(['room', 'targets', room.id, '--message', source.id]).status, 1);
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
