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
  } finally {
    run(['--socket', socket, 'daemon', 'stop']);
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
});
