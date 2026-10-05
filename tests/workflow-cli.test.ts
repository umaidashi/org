import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('Workflow CLI persists a one-shot receipt across processes, observes status and cancel, and never logs credentials or input', async () => {
  const home = mkdtempSync('/tmp/org-workflow-cli-'),
    db = home + '/org.db',
    config = home + '/config.json';
  let invokes = 0,
    state = 'running';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/webhook/check') {
        assert.equal(request.headers.get('X-N8N-API-KEY'), null);
        assert.deepEqual(await request.json(), { marker: 'PRIVATE_INPUT' });
        invokes++;
        return Response.json({ executionId: '12' });
      }
      assert.equal(request.headers.get('X-N8N-API-KEY'), 'fixture-key');
      if (path === '/api/v1/executions/12/stop') {
        state = 'canceled';
        return Response.json({ status: state });
      }
      return Response.json({ id: '12', workflowId: 'build', status: state });
    },
  });
  writeFileSync(
    config,
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKeyEnv: 'ORG_WORKFLOW_KEY',
      workflows: [{ id: 'build', path: 'check' }],
    }),
  );
  const run = async (args: string[]) => {
    const child = spawn(process.execPath, ['--no-env-file', cli, '--db', db, '--direct', ...args], {
      env: { ...process.env, ORG_WORKFLOW_KEY: 'fixture-key' },
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (v: Buffer) => {
      stdout += v.toString();
    });
    child.stderr.on('data', (v: Buffer) => {
      stderr += v.toString();
    });
    const status = await new Promise((resolve) => child.once('exit', resolve));
    return { stdout, stderr, status };
  };
  try {
    const args = [
      'workflow',
      'run',
      'build',
      '--key',
      'once',
      '--input',
      '{"marker":"PRIVATE_INPUT"}',
      '--config',
      config,
      '--json',
    ];
    const first = await run(args);
    assert.equal(first.status, 0, first.stderr);
    const started: unknown = JSON.parse(first.stdout);
    assert.ok(
      record(started) && record(started.payload) && typeof started.payload.requestId === 'string',
    );
    const requestId = started.payload.requestId;
    const second = await run(args);
    assert.notEqual(second.status, 0);
    assert.equal(invokes, 1);
    const observed = await run(['workflow', 'status', requestId, '--config', config, '--json']);
    assert.equal(observed.status, 0, observed.stderr);
    const value: unknown = JSON.parse(observed.stdout);
    assert.ok(record(value) && record(value.payload));
    assert.equal(value.payload.status, 'running');
    const cancelled = await run(['workflow', 'cancel', requestId, '--config', config, '--json']);
    assert.equal(cancelled.status, 0, cancelled.stderr);
    const history = await run(['workflow', 'history', requestId, '--json']);
    assert.equal(history.status, 0, history.stderr);
    const events: unknown = JSON.parse(history.stdout);
    assert.ok(Array.isArray(events) && events.length === 4);
    assert.ok(
      ![first, second, observed, cancelled, history].some((r) =>
        /fixture-key|PRIVATE_INPUT/.test(r.stdout + r.stderr),
      ),
    );
    assert.equal(invokes, 1);
    const absent = home + '/absent.db';
    const invalid = await run([
      '--db',
      absent,
      'workflow',
      'run',
      'build',
      '--key',
      'other',
      '--input',
      'not-json',
      '--config',
      config,
    ]);
    assert.notEqual(invalid.status, 0);
    assert.equal(existsSync(absent), false);
  } finally {
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 10000);
