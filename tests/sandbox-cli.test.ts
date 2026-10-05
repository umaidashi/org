import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
import { createAgent } from '../src/agents/domain.js';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'real Sandbox CLI executes a Task, persists an artifact and requires explicit review',
  () => {
    const home = mkdtempSync('/tmp/org-sandbox-cli-'),
      db = home + '/org.db';
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, { cwd: home, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    git('init', '--quiet');
    writeFileSync(home + '/source.ts', 'export const marker=7;');
    writeFileSync(home + '/.env', 'fixture-secret');
    git('add', 'source.ts', '.env');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Fixture',
    );
    writeFileSync(home + '/untracked.txt', 'private');
    const tasks = new SqliteTaskProvider(db),
      agents = new SqliteAgentRepository(db);
    agents.insert(
      createAgent(
        {
          name: 'worker',
          role: 'Code',
          runtime: 'codex',
          capabilities: [],
        },
        { id: 'worker', createdAt: 'before' },
      ),
    );
    tasks.create(
      createTask(
        { title: 'Code', objective: '7', kind: 'execution_task' },
        { id: 'task', createdAt: 'before' },
      ),
    );
    tasks.update('task', { owner: 'worker' }, 'assigned');
    tasks.close();
    agents.close();
    const run = (args: string[]) =>
      spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
        encoding: 'utf8',
        timeout: 10000,
      });
    try {
      assert.equal(run(['sandbox', 'run', 'task', '--code', 'console.log(7)']).status, 1);
      const requested = run([
        'approval',
        'request',
        'worker',
        '--key',
        'sandbox-grants',
        '--actor',
        'founder',
        '--expected-revision',
        '0',
        '--capability',
        'can_run_shell',
        '--capability',
        'can_write',
        '--capability',
        'can_read',
        '--json',
      ]);
      assert.equal(requested.status, 0, requested.stderr);
      const request: unknown = JSON.parse(requested.stdout);
      assert.ok(
        request !== null &&
          typeof request === 'object' &&
          'id' in request &&
          typeof request.id === 'string',
      );
      assert.equal(run(['sandbox', 'run', 'task', '--code', 'console.log(7)']).status, 1);
      assert.equal(
        run([
          'approval',
          'decide',
          request.id,
          '--actor',
          'founder',
          '--decision',
          'approve',
          '--reason',
          'Bounded local sandbox',
        ]).status,
        0,
      );
      assert.equal(run(['approval', 'apply', request.id, '--actor', 'founder']).status, 0);
      const executed = run([
        'sandbox',
        'run',
        'task',
        '--code',
        "import {marker} from './source.ts';if(await Bun.file('.env').exists()||await Bun.file('untracked.txt').exists())throw new Error('leak');await Bun.write('source.ts','changed');await Bun.write('result.txt','artifact');console.log(marker)",
        '--repo',
        home,
        '--file',
        'result.txt',
        '--writable',
        '--json',
      ]);
      assert.equal(executed.status, 0, executed.stderr);
      assert.equal(readFileSync(home + '/source.ts', 'utf8'), 'export const marker=7;');
      const provider = new SqliteTaskProvider(db);
      try {
        const task = provider.get('task');
        assert.equal(task.status, 'waiting_approval');
        assert.equal(task.outputArtifacts.length, 1);
        const artifact = provider.artifacts('task')[0];
        assert.ok(artifact);
        const read = run(['sandbox', 'artifact', artifact.uri]);
        assert.equal(read.status, 0, read.stderr);
        const content: unknown = JSON.parse(read.stdout);
        assert.deepEqual(content, {
          stdout: '7\n',
          files: [{ path: 'result.txt', base64: Buffer.from('artifact').toString('base64') }],
        });
        assert.equal(run(['sandbox', 'run', 'task', '--code', 'console.log(99)']).status, 1);
        const reviewed = run([
          'task',
          'review',
          'task',
          '--decision',
          'approve',
          '--actor',
          'founder',
          '--reason',
          'Verified marker',
          '--expected-version',
          String(task.version),
          '--json',
        ]);
        assert.equal(reviewed.status, 0, reviewed.stderr);
        assert.equal(provider.get('task').status, 'completed');
        const audit = run(['audit', 'list', '--json']);
        assert.equal(audit.status, 0, audit.stderr);
        const history = provider.history('task');
        for (const entry of history.filter((x) => x.status === 'waiting_approval')) {
          assert.ok(audit.stdout.includes(`org://tasks/task/versions/${entry.version}`));
        }
        assert.ok(audit.stdout.includes('succeeded'));
        assert.ok(audit.stdout.includes('agent.capabilities.change'));
      } finally {
        provider.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
  15000,
);
