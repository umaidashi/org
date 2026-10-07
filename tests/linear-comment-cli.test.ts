import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
import { createTask } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('native existing Linear comment requires exact human approval and never replays across CLI reopen', async () => {
  const home = mkdtempSync('/tmp/org-linear-comment-');
  const db = home + '/org.db';
  const issue = {
    id: '11111111-1111-4111-8111-111111111111',
    identifier: 'ORG-1',
    title: 'existing',
    description: 'original',
    url: 'https://linear.app/org/issue/ORG-1/existing',
  };
  const taskId = 'linear:issue:' + issue.id;
  let posts = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      assert.equal(request.headers.get('Authorization'), 'fixture-comment-key');
      const payload: unknown = await request.json();
      assert.ok(record(payload) && typeof payload.query === 'string' && record(payload.variables));
      if (!payload.query.includes('commentCreate')) return Response.json({ data: { issue } });
      assert.equal(payload.variables.issueId, issue.id);
      assert.equal(payload.variables.body, 'Verified fixture result');
      assert.match(
        String(payload.variables.id),
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      posts++;
      return Response.json({
        data: {
          commentCreate: {
            success: true,
            comment: {
              id: payload.variables.id,
              body: payload.variables.body,
              issue: { id: issue.id },
              url: issue.url + '#comment-' + String(payload.variables.id),
            },
          },
        },
      });
    },
  });
  writeFileSync(
    home + '/preload.ts',
    `const original=globalThis.fetch;globalThis.fetch=(url,init)=>{if(url!=="https://api.linear.app/graphql")throw Error("unexpected endpoint");return original(${JSON.stringify('http://127.0.0.1:' + server.port)},init)};`,
  );
  const run = async (args: string[]) => {
    const child = spawn(
      process.execPath,
      ['--no-env-file', '--preload', home + '/preload.ts', cli, '--direct', '--db', db, ...args],
      {
        env: { HOME: home, PATH: process.env.PATH ?? '', LINEAR_API_KEY: 'fixture-comment-key' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    let code: number | null;
    try {
      code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
    } finally {
      clearTimeout(timeout);
    }
    assert.doesNotMatch(stdout + stderr, /fixture-comment-key/);
    return { code, stdout, stderr };
  };
  const tasks = new SqliteTaskProvider(db);
  try {
    tasks.create({
      ...createTask(
        { title: issue.title, objective: 'Linear source: ' + issue.url },
        { id: taskId, createdAt: '2026-10-07T00:00:00.000Z' },
      ),
      externalRef: issue.url,
    });
  } finally {
    tasks.close();
  }
  try {
    const request = await run([
      'task',
      'request-linear-comment',
      taskId,
      '--expected-version',
      '0',
      '--actor',
      'operator',
      '--body',
      'Verified fixture result',
      '--key',
      'owned-comment',
      '--json',
    ]);
    assert.equal(request.code, 0, request.stderr);
    const approval: unknown = JSON.parse(request.stdout);
    assert.ok(record(approval) && typeof approval.id === 'string');
    const approvalId = approval.id;
    assert.equal(posts, 0);
    const apply = (body = 'Verified fixture result', actor = 'operator') =>
      run([
        'task',
        'apply-linear-comment',
        taskId,
        '--expected-version',
        '0',
        '--actor',
        actor,
        '--body',
        body,
        '--approval',
        approvalId,
      ]);
    assert.equal((await apply()).code, 1);
    assert.equal(posts, 0);
    const decided = await run([
      'approval',
      'decide',
      approvalId,
      '--actor',
      'reviewer',
      '--decision',
      'approve',
      '--reason',
      'Owned fixture approval',
    ]);
    assert.equal(decided.code, 0, decided.stderr);
    assert.equal((await apply('changed body')).code, 1);
    assert.equal((await apply('Verified fixture result', 'other')).code, 1);
    assert.equal(posts, 0);
    const completed = await apply();
    assert.equal(completed.code, 0, completed.stderr);
    assert.equal(posts, 1);
    assert.equal((await apply()).code, 1);
    assert.equal(posts, 1);
  } finally {
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
