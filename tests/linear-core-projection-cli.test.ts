import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cli } from './cli-path.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
test('mapped Linear CLI reads and explicitly syncs external WorkItems without altering internal ExecutionTasks', async () => {
  const home = mkdtempSync('/tmp/org-linear-core-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const state = '22222222-2222-4222-8222-222222222222',
    completedState = '55555555-5555-4555-8555-555555555555',
    user = '33333333-3333-4333-8333-333333333333';
  const issue = {
    id: '11111111-1111-4111-8111-111111111111',
    identifier: 'ORG-1',
    title: 'Remote',
    description: 'Objective',
    url: 'https://linear.app/org/issue/ORG-1/remote',
    state: { id: state },
    assignee: { id: user } as { id: string } | null,
    priority: 2,
    labels: {
      nodes: [{ id: '44444444-4444-4444-8444-444444444444', name: 'bug' }],
      pageInfo: { hasNextPage: false },
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  };
  const agents = new SqliteAgentRepository(db);
  agents.insert(
    createAgent(
      { name: 'Reader', role: 'reader', runtime: 'claude' },
      { id: 'reader', createdAt: 'now' },
    ),
  );
  agents.close();
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      calls++;
      assert.equal(request.headers.get('Authorization'), 'fixture-core-key');
      const value: unknown = await request.json();
      assert.ok(
        value !== null &&
          typeof value === 'object' &&
          'query' in value &&
          typeof value.query === 'string' &&
          'variables' in value,
      );
      assert.ok(value.query.startsWith('query '));
      assert.deepEqual(value.variables, { id: issue.id });
      return Response.json({ data: { issue } });
    },
  });
  const mapping = home + '/mapping.json',
    preload = home + '/http.ts';
  writeFileSync(
    mapping,
    JSON.stringify({
      states: { [state]: 'running', [completedState]: 'completed' },
      owners: { [user]: 'reader' },
    }),
  );
  writeFileSync(
    preload,
    `const original=globalThis.fetch;globalThis.fetch=(url,init)=>original(String(url)==='https://api.linear.app/graphql'?${JSON.stringify(server.url.href)}:url,init);`,
  );
  const env = {
    ...process.env,
    LINEAR_API_KEY: 'fixture-core-key',
    ORG_LINEAR_TASK_MAPPING: mapping,
  };
  let daemon: ReturnType<typeof spawn> | undefined, daemonExited: Promise<unknown> | undefined;
  const run = async (args: string[], config = mapping, direct = true) => {
    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '--preload',
        preload,
        cli,
        ...(direct ? ['--direct'] : ['--socket', socket]),
        '--db',
        db,
        ...args,
      ],
      {
        env: {
          ...env,
          ORG_LINEAR_TASK_MAPPING: config,
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 10000,
      },
    );
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { status, stdout, stderr };
  };
  try {
    const created = await run([
      'task',
      'create',
      'Internal',
      '--kind',
      'execution_task',
      '--objective',
      'Inspect',
      '--json',
    ]);
    assert.equal(created.status, 0, created.stderr);
    const internal: unknown = JSON.parse(created.stdout);
    assert.ok(
      internal !== null &&
        typeof internal === 'object' &&
        'id' in internal &&
        typeof internal.id === 'string',
    );
    const history = await run(['task', 'history', internal.id, '--json']);
    assert.equal(history.status, 0, history.stderr);
    const original = await run(['task', 'list', '--json']);
    assert.equal(original.status, 0);
    const args = ['task', 'linear-get', issue.id, '--mapped', '--json'];
    const result = await run(args);
    assert.equal(result.status, 0, result.stderr);
    const work: unknown = JSON.parse(result.stdout);
    assert.deepEqual(work, {
      id: 'linear:issue:' + issue.id,
      kind: 'work_item',
      title: issue.title,
      objective: issue.description,
      status: 'running',
      owner: 'reader',
      priority: 2,
      labels: ['bug'],
      externalRef: issue.url,
      parentId: null,
      dependencies: [],
      inputArtifacts: [],
      outputArtifacts: [],
      version: 0,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    });
    assert.deepEqual(
      JSON.parse((await run(['task', 'list', '--json'])).stdout),
      JSON.parse(original.stdout),
    );
    assert.deepEqual(JSON.parse((await run(args)).stdout), work);
    assert.equal(calls, 2);
    const historyAfter = await run(['task', 'history', internal.id, '--json']);
    assert.equal(historyAfter.status, 0, historyAfter.stderr);
    assert.deepEqual(JSON.parse(historyAfter.stdout), JSON.parse(history.stdout));
    const invalid = await run([...args, '--agent', 'reader']);
    assert.equal(invalid.status, 2);
    assert.equal(calls, 2);
    const absent = await run(args, home + '/absent.json');
    assert.equal(absent.status, 1);
    assert.equal(calls, 2);
    issue.assignee = null;
    const unassigned = await run(args);
    assert.equal(unassigned.status, 0, unassigned.stderr);
    const value: unknown = JSON.parse(unassigned.stdout);
    assert.ok(value !== null && typeof value === 'object' && 'owner' in value);
    assert.equal(value.owner, null);
    const imported = await run(['task', 'import-linear', issue.id, '--json']);
    assert.equal(imported.status, 0, imported.stderr);
    const taskId = 'linear:issue:' + issue.id;
    const sync = await run(['task', 'sync-linear', taskId, '--expected-version', '0', '--json']);
    assert.equal(sync.status, 0, sync.stderr);
    const synced: unknown = JSON.parse(sync.stdout);
    assert.ok(
      synced !== null &&
        typeof synced === 'object' &&
        'status' in synced &&
        'owner' in synced &&
        'version' in synced,
    );
    assert.equal(synced.status, 'running');
    assert.equal(synced.owner, null);
    assert.equal(synced.version, 1);
    const reread = await run(['task', 'get', taskId, '--json']);
    assert.equal(reread.status, 0, reread.stderr);
    assert.deepEqual(JSON.parse(reread.stdout), synced);
    const beforeStale = calls;
    const stale = await run(['task', 'sync-linear', taskId, '--expected-version', '0', '--json']);
    assert.equal(stale.status, 1, stale.stderr);
    assert.equal(calls, beforeStale);
    const unchanged = await run([
      'task',
      'sync-linear',
      taskId,
      '--expected-version',
      '1',
      '--json',
    ]);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.deepEqual(JSON.parse(unchanged.stdout), synced);
    const originalHistory = await run(['task', 'history', taskId, '--json']);
    assert.equal(originalHistory.status, 0, originalHistory.stderr);
    assert.equal(JSON.parse(originalHistory.stdout).length, 2);
    issue.state.id = user;
    const unmapped = await run([
      'task',
      'sync-linear',
      taskId,
      '--expected-version',
      '1',
      '--json',
    ]);
    assert.equal(unmapped.status, 1, unmapped.stderr);
    assert.deepEqual(
      JSON.parse((await run(['task', 'history', taskId, '--json'])).stdout),
      JSON.parse(originalHistory.stdout),
    );
    issue.state.id = completedState;
    const completed = await run([
      'task',
      'sync-linear',
      taskId,
      '--expected-version',
      '1',
      '--json',
    ]);
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(JSON.parse(completed.stdout).status, 'completed');
    assert.equal(JSON.parse(completed.stdout).version, 2);
    issue.state.id = state;
    issue.assignee = { id: user };
    daemon = spawn(
      process.execPath,
      ['--no-env-file', '--preload', preload, cli, '--db', db, 'daemon', '--socket', socket],
      { env },
    );
    daemonExited = new Promise((resolve) => daemon?.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('daemon not ready')), 5000);
      daemon?.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const reopened = await run(
      ['task', 'sync-linear', taskId, '--expected-version', '2', '--json'],
      mapping,
      false,
    );
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.equal(JSON.parse(reopened.stdout).status, 'running');
    assert.equal(JSON.parse(reopened.stdout).owner, 'reader');
    assert.equal(JSON.parse(reopened.stdout).version, 3);
    const stopped = await run(['daemon', 'stop'], mapping, false);
    assert.equal(stopped.status, 0, stopped.stderr);
    await daemonExited;
    daemon = undefined;
    assert.deepEqual(
      JSON.parse((await run(['task', 'get', taskId, '--json'])).stdout),
      JSON.parse(reopened.stdout),
    );
    assert.deepEqual(
      JSON.parse((await run(['task', 'history', internal.id, '--json'])).stdout),
      JSON.parse(history.stdout),
    );
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await daemonExited;
    }
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
