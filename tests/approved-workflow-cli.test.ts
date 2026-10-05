import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('native CLI invokes write Workflow only after exact human approval and never replays it', async () => {
  const home = mkdtempSync('/tmp/org-approved-workflow-cli-'),
    db = home + '/org.db',
    config = home + '/workflow.json';
  let invokes = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (r) => {
      if (new URL(r.url).pathname.startsWith('/api/')) {
        assert.equal(r.headers.get('X-N8N-API-KEY'), 'fixture-secret');
        return Response.json({ id: '13', workflowId: 'flow', status: 'success' });
      }
      assert.equal(r.headers.get('X-N8N-API-KEY'), null);
      assert.deepEqual(await r.json(), { marker: 'PRIVATE_INPUT' });
      invokes++;
      return Response.json({ executionId: '13' });
    },
  });
  writeFileSync(
    config,
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKeyEnv: 'ORG_WORKFLOW_KEY',
      workflows: [{ id: 'flow', path: 'check', effect: 'write' }],
    }),
  );
  const run = async (args: string[]) => {
    const child = spawn(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', db, ...args, '--json'],
      { env: { ...process.env, ORG_WORKFLOW_KEY: 'fixture-secret' } },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (v) => (stdout += v));
    child.stderr.on('data', (v) => (stderr += v));
    const status = await new Promise((r) => child.once('exit', r));
    assert.ok(!stdout.includes('fixture-secret') && !stderr.includes('fixture-secret'));
    return { status, stdout, stderr };
  };
  const json = async (args: string[]): Promise<unknown> => {
    const r = await run(args);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const base = [
    'flow',
    '--config',
    config,
    '--key',
    'one',
    '--input',
    '{"marker":"PRIVATE_INPUT"}',
  ];
  try {
    assert.notEqual((await run(['workflow', 'run', ...base])).status, 0);
    assert.equal(invokes, 0);
    const request = await json(['workflow', 'request-approval', ...base, '--actor', 'founder']);
    assert.ok(record(request) && typeof request.id === 'string');
    assert.ok(!JSON.stringify(request).includes('PRIVATE_INPUT'));
    assert.deepEqual(
      await json(['workflow', 'request-approval', ...base, '--actor', 'founder']),
      request,
    );
    assert.notEqual(
      (await run(['workflow', 'run', ...base, '--approval', request.id, '--actor', 'founder']))
        .status,
      0,
    );
    await json([
      'approval',
      'decide',
      request.id,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'Verified exact operation',
    ]);
    const changed = [...base];
    changed[changed.indexOf('--input') + 1] = '{"marker":"CHANGED"}';
    assert.notEqual(
      (await run(['workflow', 'run', ...changed, '--approval', request.id, '--actor', 'founder']))
        .status,
      0,
    );
    assert.equal(invokes, 0);
    const started = await json([
      'workflow',
      'run',
      ...base,
      '--approval',
      request.id,
      '--actor',
      'founder',
    ]);
    assert.ok(record(started) && record(started.payload));
    assert.equal(started.payload.approvalId, request.id);
    assert.equal(started.payload.effect, 'write');
    assert.equal(invokes, 1);
    assert.notEqual(
      (await run(['workflow', 'run', ...base, '--approval', request.id, '--actor', 'founder']))
        .status,
      0,
    );
    assert.equal(invokes, 1);
    const audit = await json(['audit', 'list']);
    assert.ok(Array.isArray(audit));
    assert.deepEqual(
      audit.map((v: unknown) => {
        assert.ok(record(v));
        return v.result;
      }),
      ['pending', 'approved', 'pending', 'started'],
    );
    const invoked: unknown = audit.at(-1);
    assert.ok(record(invoked));
    assert.equal(invoked.approvalId, request.id);
    assert.equal(invoked.tool, 'workflow.invoke');
  } finally {
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
