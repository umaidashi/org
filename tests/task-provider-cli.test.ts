import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cli } from './cli-path.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
function record(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
}
test('common async Task consumer uses Local and scoped Linear create/get/list with real HTTP pages and preserved Local originals', async () => {
  const home = mkdtempSync('/tmp/org-task-provider-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const state = '33333333-3333-4333-8333-333333333333',
    completedState = '44444444-4444-4444-8444-444444444444';
  const issues = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ].map((id, i) => ({
    id,
    identifier: `ORG-${i + 1}`,
    title: `Remote ${i + 1}`,
    description: 'Remote objective',
    url: `https://linear.app/org/issue/ORG-${i + 1}/existing`,
    state: { id: state },
    assignee: null,
    priority: 2,
    labels: { nodes: [], pageInfo: { hasNextPage: false } },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  }));
  const agents = new SqliteAgentRepository(db);
  agents.insert(
    createAgent(
      { name: 'Reader', role: 'reader', runtime: 'claude' },
      { id: 'reader', createdAt: 'now' },
    ),
  );
  agents.close();
  let calls = 0,
    listCalls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      calls++;
      assert.equal(request.headers.get('Authorization'), 'fixture-provider-key');
      const body: unknown = await request.json();
      assert.ok(
        body !== null &&
          typeof body === 'object' &&
          'query' in body &&
          typeof body.query === 'string' &&
          'variables' in body &&
          body.variables !== null &&
          typeof body.variables === 'object',
      );
      assert.ok(body.query.startsWith('query '));
      if (body.query.startsWith('query KernelCoreWorkItems(')) {
        listCalls++;
        assert.ok('after' in body.variables);
        const second = body.variables.after === 'next';
        assert.deepEqual(body.variables, { team: 'ORG', first: 50, after: second ? 'next' : null });
        return Response.json({
          data: {
            issues: {
              nodes: [issues[second ? 1 : 0]],
              pageInfo: { hasNextPage: !second, endCursor: second ? null : 'next' },
            },
          },
        });
      }
      assert.ok('id' in body.variables);
      const variables = body.variables;
      assert.ok('id' in variables);
      const issue = issues.find((candidate) => candidate.id === variables.id);
      assert.ok(issue);
      return Response.json({ data: { issue } });
    },
  });
  const mapping = home + '/mapping.json',
    preload = home + '/http.ts';
  writeFileSync(
    mapping,
    JSON.stringify({ states: { [state]: 'running', [completedState]: 'completed' }, owners: {} }),
  );
  writeFileSync(
    preload,
    `const original=globalThis.fetch;globalThis.fetch=(url,init)=>original(String(url)==='https://api.linear.app/graphql'?${JSON.stringify(server.url.href)}:url,init);`,
  );
  const env = {
    ...process.env,
    LINEAR_API_KEY: 'fixture-provider-key',
    ORG_LINEAR_TASK_MAPPING: mapping,
    ORG_LINEAR_TASK_TEAM: 'ORG',
  };
  let daemon: ReturnType<typeof spawn> | undefined, daemonExited: Promise<unknown> | undefined;
  const run = async (args: string[], direct = true) => {
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
        env,
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
      'Local',
      '--objective',
      'Local objective',
      '--provider',
      'local',
      '--id',
      'local',
      '--json',
    ]);
    assert.equal(created.status, 0, created.stderr);
    const local: unknown = JSON.parse(created.stdout);
    assert.ok(local !== null && typeof local === 'object' && 'id' in local && 'title' in local);
    assert.equal(local.id, 'local');
    assert.equal(local.title, 'Local');
    assert.deepEqual(
      JSON.parse((await run(['task', 'get', 'local', '--provider', 'local', '--json'])).stdout),
      local,
    );
    const first = issues[0];
    assert.ok(first);
    const id = 'linear:issue:' + first.id;
    const read = await run(['task', 'get', id, '--provider', 'linear', '--json']);
    assert.equal(read.status, 0, read.stderr);
    const remote: unknown = JSON.parse(read.stdout);
    assert.ok(
      remote !== null && typeof remote === 'object' && 'status' in remote && 'version' in remote,
    );
    assert.equal(remote.status, 'running');
    assert.equal(remote.version, 0);
    const mirror = await run([
      'task',
      'create',
      'Local hint',
      '--objective',
      'Local hint',
      '--provider',
      'linear',
      '--id',
      id,
      '--external-ref',
      first.url,
      '--parent',
      'local',
      '--json',
    ]);
    assert.equal(mirror.status, 0, mirror.stderr);
    const mirrored: unknown = JSON.parse(mirror.stdout);
    record(mirrored);
    assert.equal(mirrored.title, first.title);
    assert.equal(mirrored.objective, first.description);
    assert.equal(mirrored.parentId, 'local');
    assert.equal(mirrored.status, 'running');
    assert.equal(mirrored.createdAt, mirrored.updatedAt);
    const beforeDuplicate = calls;
    assert.equal(
      (
        await run([
          'task',
          'create',
          'Ignored',
          '--objective',
          'Ignored',
          '--provider',
          'linear',
          '--id',
          id,
          '--external-ref',
          first.url,
        ])
      ).status,
      1,
    );
    assert.equal(calls, beforeDuplicate);
    const linked = await run([
      'task',
      'artifact',
      id,
      '--artifact',
      'output',
      '--uri',
      'https://example.test/output',
      '--direction',
      'output',
      '--json',
    ]);
    assert.equal(linked.status, 0, linked.stderr);
    first.state.id = completedState;
    const live = await run(['task', 'get', id, '--provider', 'linear', '--json']);
    assert.equal(live.status, 0, live.stderr);
    const current: unknown = JSON.parse(live.stdout);
    record(current);
    assert.equal(current.status, 'completed');
    assert.equal(current.version, 2);
    assert.equal(current.parentId, 'local');
    assert.deepEqual(current.outputArtifacts, ['output']);
    assert.equal(current.createdAt, mirrored.createdAt);
    assert.deepEqual(
      JSON.parse((await run(['task', 'get', id, '--provider', 'local', '--json'])).stdout),
      current,
    );
    const beforeList = calls;
    const listed = await run(['task', 'list', '--provider', 'linear', '--json']);
    assert.equal(listed.status, 0, listed.stderr);
    const tasks: unknown = JSON.parse(listed.stdout);
    assert.ok(Array.isArray(tasks));
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks[0], current);
    const second: unknown = tasks[1];
    record(second);
    assert.equal(second.title, 'Remote 2');
    assert.equal(second.status, 'running');
    assert.equal(calls - beforeList, 2);
    assert.equal(listCalls, 2);
    assert.deepEqual(
      JSON.parse(
        (await run(['task', 'list', '--provider', 'linear', '--status', 'completed', '--json']))
          .stdout,
      ),
      [current],
    );
    const localList: unknown = JSON.parse(
      (await run(['task', 'list', '--provider', 'local', '--json'])).stdout,
    );
    assert.ok(Array.isArray(localList));
    assert.equal(localList.length, 2);
    assert.deepEqual(
      localList.find((task: unknown) => {
        record(task);
        return task.id === 'local';
      }),
      local,
    );
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
    first.title = 'Changed via RPC';
    const viaRpc = await run(['task', 'get', id, '--provider', 'linear', '--json'], false);
    assert.equal(viaRpc.status, 0, viaRpc.stderr);
    const rpcTask: unknown = JSON.parse(viaRpc.stdout);
    record(rpcTask);
    assert.equal(rpcTask.title, first.title);
    assert.equal(rpcTask.version, 3);
    assert.deepEqual(rpcTask.outputArtifacts, ['output']);
    const rpcCreate = await run(
      [
        'task',
        'create',
        'RPC local',
        '--objective',
        'RPC objective',
        '--provider',
        'local',
        '--id',
        'rpc-local',
        '--json',
      ],
      false,
    );
    assert.equal(rpcCreate.status, 0, rpcCreate.stderr);
    const rpcLocal: unknown = JSON.parse(rpcCreate.stdout);
    record(rpcLocal);
    assert.equal(rpcLocal.id, 'rpc-local');
    const stopped = await run(['daemon', 'stop'], false);
    assert.equal(stopped.status, 0, stopped.stderr);
    await daemonExited;
    daemon = undefined;
    assert.deepEqual(
      JSON.parse((await run(['task', 'get', id, '--provider', 'local', '--json'])).stdout),
      rpcTask,
    );
    const beforeInvalid = calls;
    for (const args of [
      ['task', 'get', id, '--provider', 'unknown'],
      ['task', 'update', id, '--title', 'X', '--provider', 'linear'],
      ['task', 'create', 'X', '--objective', 'Y', '--provider', 'linear'],
    ])
      assert.equal((await run(args)).status, 2);
    assert.equal(calls, beforeInvalid);
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await daemonExited;
    }
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
