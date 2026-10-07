import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';

for (const direct of [true, false])
  test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
    `real CLI Sandbox credential grant protects artifacts direct=${direct}`,
    async () => {
      const home = mkdtempSync('/tmp/org-sandbox-credential-cli-'),
        db = home + '/org.db',
        socket = home + '/org.sock',
        config = home + '/grants.json';
      const secret = 'synthetic-cli-private-token-705';
      const env = { ...process.env, PRIVATE_TASK_TOKEN: secret };
      const tasks = new SqliteTaskProvider(db),
        agents = new SqliteAgentRepository(db);
      agents.insert(
        createAgent(
          { name: 'Worker', role: 'Code', runtime: 'codex', capabilities: ['can_run_shell'] },
          { id: 'worker', createdAt: 'before' },
        ),
      );
      const ids = ['safe', 'reflect', 'foreign'];
      for (const id of ids) {
        tasks.create(
          createTask(
            { title: id, objective: 'Bounded execution', kind: 'execution_task' },
            { id, createdAt: 'before' },
          ),
        );
        tasks.update(id, { owner: 'worker' }, 'assigned');
      }
      tasks.close();
      agents.close();
      writeFileSync(
        config,
        JSON.stringify(
          ids.map((taskId) => ({
            agentId: taskId === 'foreign' ? 'other' : 'worker',
            taskId,
            environmentVariable: 'SERVICE_TOKEN',
            reference: 'service:' + taskId,
            sourceEnvironmentVariable: 'PRIVATE_TASK_TOKEN',
          })),
        ),
        { mode: 0o600 },
      );
      const daemon = direct
        ? undefined
        : spawn(
            process.execPath,
            ['--no-env-file', cli, '--db', db, 'daemon', '--socket', socket],
            { env, stdio: 'ignore' },
          );
      const exited = daemon ? new Promise((resolve) => daemon.once('exit', resolve)) : undefined;
      const run = (args: string[]) =>
        spawnSync(
          process.execPath,
          [
            '--no-env-file',
            cli,
            ...(direct ? ['--direct'] : ['--socket', socket]),
            '--db',
            db,
            ...args,
          ],
          { env, encoding: 'utf8', timeout: 10000 },
        );
      try {
        if (daemon) {
          for (let i = 0; i < 100 && !existsSync(socket); i++) await Bun.sleep(20);
          assert.ok(existsSync(socket));
        }
        const safe = run([
          'sandbox',
          'run',
          'safe',
          '--credential-config',
          config,
          '--code',
          "if(!process.env.SERVICE_TOKEN||process.env.PRIVATE_TASK_TOKEN)throw new Error('credential mismatch');console.log('present');",
          '--json',
        ]);
        assert.equal(safe.status, 0, safe.stderr);
        for (const id of ['reflect', 'foreign']) {
          const denied = run([
            'sandbox',
            'run',
            id,
            '--credential-config',
            config,
            '--code',
            'console.log(process.env.SERVICE_TOKEN)',
            '--json',
          ]);
          assert.notEqual(denied.status, 0);
          assert.ok(!(denied.stdout + denied.stderr).includes(secret));
        }
        const reopened = new SqliteTaskProvider(db);
        try {
          assert.equal(reopened.get('safe').status, 'waiting_approval');
          const artifact = reopened.artifacts('safe')[0];
          assert.ok(artifact);
          const read = run(['sandbox', 'artifact', artifact.uri]);
          assert.equal(read.status, 0, read.stderr);
          assert.equal(read.stdout.trim(), 'present');
          for (const id of ['reflect', 'foreign']) {
            assert.equal(reopened.get(id).status, 'failed');
            assert.equal(reopened.artifacts(id).length, 0);
          }
        } finally {
          reopened.close();
        }
        assert.ok(!readFileSync(db).includes(Buffer.from(secret)));
      } finally {
        if (daemon) {
          daemon.kill('SIGTERM');
          await exited;
        }
        rmSync(home, { recursive: true, force: true });
      }
    },
    15000,
  );

test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'continuous daemon injects its host Sandbox grant into a Runtime proposal',
  async () => {
    const home = mkdtempSync('/tmp/org-sandbox-credential-auto-'),
      db = home + '/org.db',
      socket = home + '/org.sock';
    const tasks = new SqliteTaskProvider(db),
      agents = new SqliteAgentRepository(db);
    agents.insert(
      createAgent(
        {
          name: 'Worker',
          role: 'Code',
          runtime: 'codex',
          capabilities: ['can_read', 'can_run_shell'],
        },
        { id: 'worker', createdAt: 'before' },
      ),
    );
    tasks.create(
      createTask(
        { title: 'Auto', objective: 'Execute bounded proposal', kind: 'execution_task' },
        { id: 'auto', createdAt: 'before' },
      ),
    );
    tasks.update('auto', { owner: 'worker' }, 'assigned');
    agents.close();
    tasks.close();
    const driver = home + '/driver.ts',
      runtime = home + '/runtime.json',
      policy = home + '/sandbox.json',
      grants = home + '/grants.json';
    const text = JSON.stringify({
      version: 1,
      tool: 'sandbox',
      code: "if(!process.env.SERVICE_TOKEN||process.env.PRIVATE_TASK_TOKEN)throw new Error('credential mismatch');console.log('auto-present');",
    });
    writeFileSync(
      driver,
      `#!${process.execPath}\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(text)}}}));console.log(JSON.stringify({type:'turn.completed'}));`,
      { mode: 0o700 },
    );
    writeFileSync(
      runtime,
      JSON.stringify({
        codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
      }),
    );
    writeFileSync(
      policy,
      JSON.stringify({ writable: false, files: [], timeoutMs: 3000, maxOutputBytes: 4096 }),
    );
    writeFileSync(
      grants,
      JSON.stringify([
        {
          agentId: 'worker',
          taskId: 'auto',
          environmentVariable: 'SERVICE_TOKEN',
          reference: 'service:auto',
          sourceEnvironmentVariable: 'PRIVATE_TASK_TOKEN',
        },
      ]),
    );
    const daemon = spawn(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        'daemon',
        '--socket',
        socket,
        '--runtime-config',
        runtime,
        '--sandbox-config',
        policy,
        '--sandbox-credentials',
        grants,
        '--wake-up',
        '--poll-interval',
        '20',
      ],
      {
        env: { ...process.env, PRIVATE_TASK_TOKEN: 'synthetic-auto-private-token-706' },
        stdio: 'ignore',
      },
    );
    const exited = new Promise((resolve) => daemon.once('exit', resolve));
    try {
      let status = '';
      for (let i = 0; i < 300; i++) {
        const reopened = new SqliteTaskProvider(db);
        try {
          status = reopened.get('auto').status;
        } finally {
          reopened.close();
        }
        if (status === 'waiting_approval' || status === 'failed') break;
        await Bun.sleep(20);
      }
      assert.equal(status, 'waiting_approval');
      const reopened = new SqliteTaskProvider(db);
      let uri: string;
      try {
        const artifact = reopened.artifacts('auto')[0];
        assert.ok(artifact);
        uri = artifact.uri;
      } finally {
        reopened.close();
      }
      const result = spawnSync(
        process.execPath,
        ['--no-env-file', cli, '--db', db, '--socket', socket, 'sandbox', 'artifact', uri],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const manifest: unknown = JSON.parse(result.stdout);
      assert.ok(manifest && typeof manifest === 'object' && 'stdout' in manifest);
      assert.equal(manifest.stdout, 'auto-present\n');
    } finally {
      daemon.kill('SIGTERM');
      await exited;
      rmSync(home, { recursive: true, force: true });
    }
  },
  15000,
);
