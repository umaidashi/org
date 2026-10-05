import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'bun:test';

test('GitHub CLI imports immutable originals into daemon Subscription Tasks and survives long HTTP responses', async () => {
  const dir = mkdtempSync('/tmp/org-github-cli-');
  const db = join(dir, 'org.db');
  const socket = join(dir, 'org.sock');
  const preload = join(dir, 'fetch.ts');
  writeFileSync(
    preload,
    `const original=globalThis.fetch;
  globalThis.fetch=Object.assign(async (url,init)=>{
    if(String(url).startsWith('https://api.github.com/')) {
      if(process.argv.includes('daemon')) await Bun.sleep(6000);
      return Response.json([{id:'7',type:'PullRequestEvent',repo:{id:42,name:'fixture/repo'},public:true,created_at:'2026-10-05T00:00:00Z',payload:{action:'opened',number:7}}]);
    }
    return original(url,init);
  },{preconnect:original.preconnect});`,
  );
  const run = (args: string[], remote = false) =>
    spawnSync(
      process.execPath,
      [
        '--no-env-file',
        '--preload',
        preload,
        cli,
        '--db',
        db,
        ...(remote ? ['--socket', socket] : args[0] === 'daemon' ? [] : ['--direct']),
        ...args,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<number | null> | undefined;
  try {
    const invalidDb = join(dir, 'uncreated', 'org.db');
    const invalid = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', invalidDb, 'event', 'import-github', '../repo'],
      { encoding: 'utf8' },
    );
    assert.equal(invalid.status, 2);
    assert.equal(existsSync(join(dir, 'uncreated')), false);
    assert.equal(
      run(['agent', 'create', 'reader', '--role', 'Reader', '--runtime', 'codex']).status,
      0,
    );
    const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const agent = agents[0];
    assert.ok(agent);
    assert.equal(
      run([
        'event',
        'subscribe',
        'github.pull_request.opened',
        '--subscriber-type',
        'agent',
        '--subscriber',
        agent.id,
      ]).status,
      0,
    );
    const first = run(['event', 'import-github', 'Fixture/Repo', '--json']);
    assert.equal(first.status, 0, first.stderr);
    const originals = JSON.parse(first.stdout) as unknown[];
    assert.equal(originals.length, 1);
    const once = run(['daemon', '--once', '--json']);
    assert.equal(once.status, 0, once.stderr);
    const tasks = JSON.parse(run(['task', 'list', '--json']).stdout) as {
      id: string;
      status: string;
      owner: string;
    }[];
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, 'assigned');
    assert.equal(tasks[0]?.owner, agent.id);
    child = spawn(process.execPath, [
      '--no-env-file',
      '--preload',
      preload,
      cli,
      '--db',
      db,
      'daemon',
      '--socket',
      socket,
      '--poll-interval',
      '25',
    ]);
    exited = new Promise((resolve) => child?.once('exit', resolve));
    assert.ok(child.stderr);
    assert.ok(child.stdout);
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Daemon not ready')), 5000);
      child?.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child?.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const began = Date.now();
    const repeated = run(['event', 'import-github', 'fixture/repo', '--json'], true);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.ok(Date.now() - began >= 6000);
    assert.deepEqual(JSON.parse(repeated.stdout), originals);
    assert.deepEqual(JSON.parse(run(['event', 'list', '--json'], true).stdout), originals);
    assert.deepEqual(JSON.parse(run(['task', 'list', '--json'], true).stdout), tasks);
    assert.equal(run(['daemon', 'stop'], true).status, 0);
    assert.equal(await exited, 0);
    child = undefined;
    assert.deepEqual(JSON.parse(run(['event', 'list', '--json']).stdout), originals);
  } finally {
    child?.kill('SIGTERM');
    if (child) await exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 25000);
