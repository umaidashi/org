import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { cli } from './cli-path.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createAgent } from '../src/agents/domain.js';

test('Agent scoped Linear read uses its dedicated credential and rejects unscoped issue and host fallback through direct daemon and reopen', async () => {
  const home = mkdtempSync('/tmp/org-linear-agent-'),
    db = home + '/org.db';
  const id = '11111111-1111-4111-8111-111111111111';
  const scope = home + '/scopes.json',
    preload = home + '/http.ts';
  const repo = new SqliteAgentRepository(db);
  repo.insert(
    createAgent(
      {
        name: 'Reader',
        role: 'reader',
        runtime: 'claude',
        capabilities: ['can_read', 'can_access_network', 'can_contact_external'],
      },
      { id: 'reader', createdAt: 'same' },
    ),
  );
  repo.close();
  writeFileSync(
    scope,
    JSON.stringify([{ agentId: 'reader', issueIds: [id], apiKeyEnv: 'SCOPED_KEY' }]),
  );
  writeFileSync(
    preload,
    `import assert from 'node:assert/strict';const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!=='https://api.linear.app/graphql')return original(url,init);assert.equal(String(url),'https://api.linear.app/graphql');assert.equal(new Headers(init.headers).get('Authorization'),'fixture-scoped-key');const body=JSON.parse(init.body);assert.ok(body.query.startsWith('query '));assert.deepEqual(body.variables,{id:${JSON.stringify(id)}});return Response.json({data:{issue:{id:${JSON.stringify(id)},identifier:'ORG-1',title:'Existing',description:null,url:'https://linear.app/org/issue/ORG-1/existing'}}});};`,
  );
  const env = {
    ...process.env,
    ORG_LINEAR_AGENT_SCOPES: scope,
    SCOPED_KEY: 'fixture-scoped-key',
    LINEAR_API_KEY: 'fixture-host-key',
  };
  const socket = home + '/org.sock';
  const run = (issue = id, agent = 'reader', key = 'fixture-scoped-key', remote = false) =>
    spawnSync(
      process.execPath,
      [
        '--no-env-file',
        '--preload',
        preload,
        cli,
        ...(remote ? ['--socket', socket] : ['--direct']),
        '--db',
        db,
        'task',
        'linear-get',
        issue,
        '--agent',
        agent,
        '--json',
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...env,
          SCOPED_KEY: key,
          LINEAR_API_KEY: 'fixture-host-key',
        },
      },
    );
  let daemon: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  try {
    for (let reopen = 0; reopen < 2; reopen++) {
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).id, id);
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-scoped-key|fixture-host-key/);
    }
    for (const result of [
      run('22222222-2222-4222-8222-222222222222'),
      run(id, 'unknown'),
      run(id, 'reader', ''),
    ]) {
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /fixture-scoped-key|fixture-host-key/);
    }
    assert.equal(run('ORG-1').status, 2);
    daemon = spawn(
      process.execPath,
      ['--no-env-file', '--preload', preload, cli, '--db', db, 'daemon', '--socket', socket],
      { env },
    );
    exited = new Promise((resolve) => daemon?.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('daemon not ready')), 5000);
      daemon?.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const remote = run(id, 'reader', 'fixture-host-key', true);
    assert.equal(remote.status, 0, remote.stderr);
    assert.equal(JSON.parse(remote.stdout).id, id);
    const denied = run(
      '22222222-2222-4222-8222-222222222222',
      'reader',
      'fixture-scoped-key',
      true,
    );
    assert.equal(denied.status, 1);
    assert.equal(denied.stdout, '');
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
