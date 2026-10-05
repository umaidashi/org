import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
test('Linear CLI read preserves existing issue without creating database and rejects missing credentials', async () => {
  const home = mkdtempSync('/tmp/org-linear-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    preload = home + '/preload.ts';
  const issue = {
    id: '11111111-1111-4111-8111-111111111111',
    identifier: 'ORG-1',
    title: '日本語',
    description: '既存Issue',
    url: 'https://linear.app/example/issue/ORG-1/example',
  };
  writeFileSync(
    preload,
    `import assert from 'node:assert/strict';const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{if(String(input)==='https://api.linear.app/graphql'){assert.equal(init.method,'POST');assert.equal(new Headers(init.headers).get('Authorization'),'fixture-linear-key');assert.deepEqual(JSON.parse(init.body).variables,{id:'ORG-1'});return Response.json(${JSON.stringify({ data: { issue } })});}return original(input,init);};`,
  );
  const env = { ...process.env, LINEAR_API_KEY: 'fixture-linear-key' };
  const run = (args: string[], key = 'fixture-linear-key') =>
    spawnSync(process.execPath, ['--no-env-file', '--preload', preload, cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...env, LINEAR_API_KEY: key },
    });
  let daemon: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  try {
    for (const args of [
      ['task', 'linear-get', 'https://evil.test'],
      ['task', 'linear-get', 'ORG-1', 'extra'],
      ['task', 'linear-get', 'ORG-1', '--owner', 'a'],
    ])
      assert.equal(run(['--direct', ...args]).status, 2);
    const missing = run(['--direct', 'task', 'linear-get', 'ORG-1'], '');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Linear credential unavailable/);
    const direct = run(['--direct', 'task', 'linear-get', 'ORG-1', '--json']);
    assert.equal(direct.status, 0, direct.stderr);
    assert.deepEqual(JSON.parse(direct.stdout), { provider: 'linear', ...issue });
    assert.doesNotMatch(direct.stdout, /fixture-linear-key/);
    assert.equal(existsSync(db), false);
    daemon = spawn(
      process.execPath,
      ['--no-env-file', '--preload', preload, cli, '--db', db, 'daemon', '--socket', socket],
      { env },
    );
    exited = new Promise((r) => daemon?.once('exit', r));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('daemon not ready')), 5000);
      daemon?.stdout?.on('data', (b: Buffer) => {
        if (b.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const remote = run(['--socket', socket, 'task', 'linear-get', 'ORG-1', '--json']);
    assert.equal(remote.status, 0, remote.stderr);
    assert.deepEqual(JSON.parse(remote.stdout), JSON.parse(direct.stdout));
    const imported = run(['--socket', socket, 'task', 'import-linear', 'ORG-1', '--json']);
    assert.equal(imported.status, 0, imported.stderr);
    const work: unknown = JSON.parse(imported.stdout);
    assert.ok(
      work !== null && typeof work === 'object' && 'id' in work && typeof work.id === 'string',
    );
    assert.ok('kind' in work && work.kind === 'work_item');
    assert.ok('externalRef' in work && work.externalRef === issue.url);
    const updated = run([
      '--socket',
      socket,
      'task',
      'update',
      work.id,
      '--title',
      'Local progress',
      '--json',
    ]);
    assert.equal(updated.status, 0, updated.stderr);
    const again = run(['--socket', socket, 'task', 'import-linear', 'ORG-1', '--json']);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout), JSON.parse(updated.stdout));
    const child = run([
      '--socket',
      socket,
      'task',
      'create',
      'Internal step',
      '--objective',
      'Inspect only',
      '--kind',
      'execution_task',
      '--parent',
      work.id,
      '--json',
    ]);
    assert.equal(child.status, 0, child.stderr);
    const parsedChild: unknown = JSON.parse(child.stdout);
    assert.ok(
      parsedChild !== null &&
        typeof parsedChild === 'object' &&
        'parentId' in parsedChild &&
        parsedChild.parentId === work.id &&
        'externalRef' in parsedChild &&
        parsedChild.externalRef === null,
    );
    const listing = run(['--socket', socket, 'task', 'list', '--json']);
    assert.equal(listing.status, 0, listing.stderr);
    const tasks: unknown = JSON.parse(listing.stdout);
    assert.ok(Array.isArray(tasks));
    assert.equal(tasks.length, 2);
    assert.equal(run(['--socket', socket, 'daemon', 'stop']).status, 0);
    await exited;
    daemon = undefined;
    const reopened = run(['--direct', 'task', 'get', work.id, '--json']);
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), JSON.parse(updated.stdout));
  } finally {
    if (daemon) {
      run(['--socket', socket, 'daemon', 'stop']);
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
