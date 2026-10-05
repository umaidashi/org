import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
test('Linear CLI read preserves existing issue without creating database and rejects missing credentials', async () => {
  const home = mkdtempSync('/tmp/org-linear-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    preload = home + '/preload.ts',
    response = home + '/issue.json';
  const issue = {
    id: '11111111-1111-4111-8111-111111111111',
    identifier: 'ORG-1',
    title: '日本語',
    description: '既存Issue',
    url: 'https://linear.app/example/issue/ORG-1/example',
  };
  writeFileSync(response, JSON.stringify({ data: { issue } }));
  writeFileSync(
    preload,
    `import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{if(String(input)==='https://api.linear.app/graphql'){assert.equal(init.method,'POST');assert.equal(new Headers(init.headers).get('Authorization'),'fixture-linear-key');const body=JSON.parse(init.body);if(body.query.startsWith('query KernelIssues(')){assert.deepEqual(body.variables,{team:'ORG',first:1,after:null});return Response.json({data:{issues:{nodes:[JSON.parse(readFileSync(${JSON.stringify(response)},'utf8')).data.issue],pageInfo:{hasNextPage:false,endCursor:'cursor'}}}});}assert.ok(['ORG-1',${JSON.stringify(issue.id)}].includes(body.variables.id));return new Response(readFileSync(${JSON.stringify(response)},'utf8'),{headers:{'Content-Type':'application/json'}});}return original(input,init);};`,
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
      ['task', 'linear-list'],
      ['task', 'linear-list', '--team', 'org'],
      ['task', 'linear-list', '--team', 'ORG', '--limit', '51'],
      ['task', 'linear-list', '--team', 'ORG', '--after', ''],
      ['task', 'refresh-linear', 'ORG-1', '--expected-version', '0'],
      ['task', 'refresh-linear', 'linear:issue:' + issue.id],
      ['task', 'refresh-linear', 'linear:issue:' + issue.id, '--expected-version', '-1'],
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
    const directList = run([
      '--direct',
      'task',
      'linear-list',
      '--team',
      'ORG',
      '--limit',
      '1',
      '--json',
    ]);
    assert.equal(directList.status, 0, directList.stderr);
    assert.deepEqual(JSON.parse(directList.stdout), {
      provider: 'linear',
      nodes: [{ provider: 'linear', ...issue }],
      pageInfo: { hasNextPage: false, endCursor: 'cursor' },
    });
    assert.equal(existsSync(db), false);
    const missingList = run(
      ['--direct', 'task', 'linear-list', '--team', 'ORG', '--limit', '1'],
      '',
    );
    assert.equal(missingList.status, 1);
    assert.doesNotMatch(missingList.stderr, /fixture-linear-key/);
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
    const remoteList = run([
      '--socket',
      socket,
      'task',
      'linear-list',
      '--team',
      'ORG',
      '--limit',
      '1',
      '--json',
    ]);
    assert.equal(remoteList.status, 0, remoteList.stderr);
    assert.deepEqual(JSON.parse(remoteList.stdout), JSON.parse(directList.stdout));
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
        'id' in parsedChild &&
        typeof parsedChild.id === 'string' &&
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
    writeFileSync(
      response,
      JSON.stringify({
        data: { issue: { ...issue, title: 'Remote edit', description: 'New scope' } },
      }),
    );
    const refresh = run([
      '--socket',
      socket,
      'task',
      'refresh-linear',
      work.id,
      '--expected-version',
      '1',
      '--json',
    ]);
    assert.equal(refresh.status, 0, refresh.stderr);
    const refreshed: unknown = JSON.parse(refresh.stdout);
    assert.ok(
      refreshed !== null &&
        typeof refreshed === 'object' &&
        'title' in refreshed &&
        refreshed.title === 'Remote edit' &&
        'version' in refreshed &&
        refreshed.version === 2,
    );
    assert.equal(
      run(['--socket', socket, 'task', 'refresh-linear', work.id, '--expected-version', '1'])
        .status,
      1,
    );
    const unchanged = run([
      '--socket',
      socket,
      'task',
      'refresh-linear',
      work.id,
      '--expected-version',
      '2',
      '--json',
    ]);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.deepEqual(JSON.parse(unchanged.stdout), refreshed);
    const childAfter = run(['--socket', socket, 'task', 'get', parsedChild.id, '--json']);
    assert.equal(childAfter.status, 0, childAfter.stderr);
    assert.deepEqual(JSON.parse(childAfter.stdout), parsedChild);
    const history = run(['--socket', socket, 'task', 'history', work.id, '--json']);
    const records: unknown = JSON.parse(history.stdout);
    assert.ok(Array.isArray(records));
    assert.equal(records.length, 3);
    assert.equal(run(['--socket', socket, 'daemon', 'stop']).status, 0);
    await exited;
    daemon = undefined;
    const reopened = run(['--direct', 'task', 'get', work.id, '--json']);
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), refreshed);
    const directRefresh = run([
      '--direct',
      'task',
      'refresh-linear',
      work.id,
      '--expected-version',
      '2',
      '--json',
    ]);
    assert.equal(directRefresh.status, 0, directRefresh.stderr);
    assert.deepEqual(JSON.parse(directRefresh.stdout), refreshed);
  } finally {
    if (daemon) {
      run(['--socket', socket, 'daemon', 'stop']);
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
