import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
const page = '3ee8a402-0cb6-81d1-8daa-cc1e0016d596';
test('Notion CLI rejects malformed input and missing credential before database or network access', () => {
  const home = mkdtempSync('/tmp/org-notion-invalid-'),
    db = home + '/absent/org.db';
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, NOTION_API_KEY: '' },
    });
  try {
    for (const args of [
      ['knowledge', 'notion', 'https://evil.test'],
      ['knowledge', 'notion', page, 'extra'],
      ['knowledge', 'notion', page, '--room', 'r'],
      ['knowledge', 'notion', page, '--human', 'h'],
      ['knowledge', 'notion', page, '--room', ' ', '--human', 'h'],
      ['knowledge', 'notion', page, '--token', 'private-body'],
    ]) {
      const r = run(args);
      assert.equal(r.status, 2);
      assert.doesNotMatch(r.stderr, /private-body/);
    }
    const r = run(['knowledge', 'notion', page, '--json']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Notion credential unavailable/);
    assert.equal(existsSync(home + '/absent'), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('Notion CLI direct and daemon paths retain native Markdown using explicit test-only HTTP fixture', async () => {
  const home = mkdtempSync('/tmp/org-notion-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    preload = home + '/preload.ts';
  const body = {
    object: 'page_markdown',
    id: page,
    markdown: '# 日本語\n供給された構想',
    truncated: false,
    unknown_block_ids: [],
  };
  writeFileSync(
    preload,
    `import assert from 'node:assert/strict';const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://api.notion.com/')){assert.equal(String(input),${JSON.stringify(`https://api.notion.com/v1/pages/${page}/markdown`)});assert.equal(init.method,'GET');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture-credential');return Response.json(${JSON.stringify(body)});}return original(input,init);};`,
  );
  const env = { ...process.env, NOTION_API_KEY: 'fixture-credential' };
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', '--preload', preload, cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env,
    });
  const direct = run(['--direct', 'knowledge', 'notion', page.replaceAll('-', ''), '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  const document: unknown = JSON.parse(direct.stdout);
  assert.ok(document !== null && typeof document === 'object' && 'content' in document);
  assert.equal(document.content, body.markdown);
  assert.doesNotMatch(direct.stdout, /fixture-credential/);
  assert.equal(existsSync(db), false);
  const created = run([
    '--direct',
    'agent',
    'create',
    'reader',
    '--role',
    'Reader',
    '--runtime',
    'codex',
  ]);
  assert.equal(created.status, 0, created.stderr);
  const listed = run(['--direct', 'agent', 'list', '--json']);
  const agents: unknown = JSON.parse(listed.stdout);
  assert.ok(Array.isArray(agents));
  const agent: unknown = agents[0];
  assert.ok(
    agent !== null && typeof agent === 'object' && 'id' in agent && typeof agent.id === 'string',
  );
  const madeRoom = run([
    '--direct',
    'room',
    'create',
    'Knowledge',
    '--type',
    'direct',
    '--human',
    'founder',
    '--agent',
    agent.id,
    '--json',
  ]);
  assert.equal(madeRoom.status, 0, madeRoom.stderr);
  const room: unknown = JSON.parse(madeRoom.stdout);
  assert.ok(
    room !== null && typeof room === 'object' && 'id' in room && typeof room.id === 'string',
  );
  const imported = run([
    '--direct',
    'knowledge',
    'notion',
    page,
    '--room',
    room.id,
    '--human',
    'founder',
    '--json',
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  const snapshot: unknown = JSON.parse(imported.stdout);
  assert.ok(
    snapshot !== null &&
      typeof snapshot === 'object' &&
      'content' in snapshot &&
      typeof snapshot.content === 'string',
  );
  assert.ok(snapshot.content.endsWith(body.markdown));
  assert.ok(snapshot.content.includes('Notion source: https://www.notion.so/'));
  assert.match(snapshot.content, /SHA256: [a-f0-9]{64}/);
  const reopened = run(['--direct', 'room', 'messages', room.id, '--json']);
  assert.equal(reopened.status, 0, reopened.stderr);
  assert.deepEqual(JSON.parse(reopened.stdout), [JSON.parse(imported.stdout)]);
  const outsider = run([
    '--direct',
    'knowledge',
    'notion',
    page,
    '--room',
    room.id,
    '--human',
    'outsider',
  ]);
  assert.equal(outsider.status, 1);
  const daemon = spawn(
    process.execPath,
    ['--no-env-file', '--preload', preload, cli, '--db', db, 'daemon', '--socket', socket],
    { env },
  );
  const exited = new Promise((r) => daemon.once('exit', r));
  let error = '';
  daemon.stderr.on('data', (b: Buffer) => {
    error += b.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(error || 'not ready')), 5000);
      daemon.stdout.on('data', (b: Buffer) => {
        if (b.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const remote = run(['--socket', socket, 'knowledge', 'notion', page, '--json']);
    assert.equal(remote.status, 0, remote.stderr);
    assert.deepEqual(JSON.parse(remote.stdout), document);
    const remoteImport = run([
      '--socket',
      socket,
      'knowledge',
      'notion',
      page,
      '--room',
      room.id,
      '--human',
      'founder',
      '--json',
    ]);
    assert.equal(remoteImport.status, 0, remoteImport.stderr);
    const originals = run(['--socket', socket, 'room', 'messages', room.id, '--json']);
    assert.equal(originals.status, 0, originals.stderr);
    assert.deepEqual(JSON.parse(originals.stdout), [
      JSON.parse(imported.stdout),
      JSON.parse(remoteImport.stdout),
    ]);
  } finally {
    run(['--socket', socket, 'daemon', 'stop']);
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
});
