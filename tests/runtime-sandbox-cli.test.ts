import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const dockerTest = process.env.ORG_DOCKER_TEST === '1' ? test : test.skip;
dockerTest(
  'Runtime proposal executes in Docker then human review projects one Memory without replay',
  async () => {
    const home = mkdtempSync('/tmp/org-runtime-sandbox-');
    const db = home + '/org.db',
      socket = home + '/org.sock';
    const config = home + '/runtime.json',
      policy = home + '/sandbox.json',
      driver = home + '/driver.ts';
    const code = 'await Bun.write("result.txt", "checked"); console.log("CHECK_OK");';
    writeFileSync(
      driver,
      `#!${process.execPath}\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify({ version: 1, tool: 'sandbox', code }))}}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
      { mode: 0o700 },
    );
    writeFileSync(
      config,
      JSON.stringify({
        codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
      }),
    );
    writeFileSync(
      policy,
      JSON.stringify({
        writable: true,
        files: ['result.txt'],
        timeoutMs: 10000,
        maxOutputBytes: 4096,
      }),
    );
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--no-env-file',
          cli,
          '--db',
          db,
          ...(args.includes('--direct') ? [] : ['--socket', socket]),
          ...args,
        ],
        { encoding: 'utf8', timeout: 5000 },
      );
    const json = (args: string[]): unknown => {
      const result = run([...args, '--json']);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const entity = (args: string[]): Record<string, unknown> & { id: string } => {
      const value = json(args);
      assert.ok(record(value) && typeof value.id === 'string');
      return { ...value, id: value.id };
    };
    let child: ReturnType<typeof spawn> | undefined;
    let exited: Promise<unknown> | undefined;
    const launch = async () => {
      child = spawn(process.execPath, [
        '--no-env-file',
        cli,
        '--db',
        db,
        'daemon',
        '--socket',
        socket,
        '--runtime-config',
        config,
        '--sandbox-config',
        policy,
        '--wake-up',
        '--poll-interval',
        '20',
      ]);
      exited = new Promise((resolve) => child?.once('exit', resolve));
      const processChild = child;
      let error = '';
      processChild.stderr?.on('data', (data: Buffer) => {
        error += data.toString();
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Daemon not ready: ' + error)), 5000);
        processChild.stdout?.on('data', (data: Buffer) => {
          if (data.toString().includes('"ready"')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    };
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 15000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error('Timed out');
        await Bun.sleep(20);
      }
    };
    try {
      assert.equal(
        run([
          '--direct',
          'agent',
          'create',
          'worker',
          '--role',
          'build',
          '--runtime',
          'codex',
          '--capability',
          'can_run_shell',
          '--capability',
          'can_write',
          '--memory-policy',
          'reviewed-tasks',
          '--capability',
          'can_read',
        ]).status,
        0,
      );
      const agents = json(['--direct', 'agent', 'list']);
      assert.ok(Array.isArray(agents) && record(agents[0]) && typeof agents[0].id === 'string');
      const agent = agents[0].id;
      entity([
        '--direct',
        'event',
        'subscribe',
        'build.*',
        '--subscriber-type',
        'agent',
        '--subscriber',
        agent,
      ]);
      await launch();
      const event = entity([
        'event',
        'publish',
        'build.ready',
        '--source',
        'test',
        '--payload',
        '{}',
      ]);
      const task = () => {
        const values = json(['task', 'list']);
        assert.ok(Array.isArray(values));
        const value: unknown = values.find(
          (value: unknown) => record(value) && value.externalRef === 'org:event:' + event.id,
        );
        return record(value) ? value : undefined;
      };
      await wait(() => task()?.status === 'waiting_approval');
      const staged = task();
      assert.ok(
        staged &&
          typeof staged.id === 'string' &&
          typeof staged.version === 'number' &&
          Array.isArray(staged.outputArtifacts) &&
          typeof staged.outputArtifacts[0] === 'string',
      );
      const artifacts = json(['task', 'artifacts', staged.id]);
      assert.ok(
        Array.isArray(artifacts) &&
          artifacts.length === 1 &&
          record(artifacts[0]) &&
          typeof artifacts[0].uri === 'string',
      );
      const output = run(['sandbox', 'artifact', artifacts[0].uri]);
      assert.equal(output.status, 0, output.stderr);
      const manifest: unknown = JSON.parse(output.stdout);
      assert.ok(
        record(manifest) &&
          typeof manifest.proposalRef === 'string' &&
          Array.isArray(manifest.files),
      );
      assert.equal(manifest.stdout, 'CHECK_OK\n');
      assert.deepEqual(manifest.files, [
        { path: 'result.txt', base64: Buffer.from('checked').toString('base64') },
      ]);
      const auditBefore = json(['audit', 'list']);
      assert.ok(Array.isArray(auditBefore));
      const sandboxAudit = auditBefore.filter(
        (entry: unknown): entry is Record<string, unknown> =>
          record(entry) && entry.tool === 'sandbox.run',
      );
      assert.equal(sandboxAudit.length, 2);
      assert.deepEqual(
        sandboxAudit.map((entry) => entry.result),
        ['started', 'succeeded'],
      );
      const sandboxResult = sandboxAudit[1];
      assert.ok(sandboxResult);
      assert.deepEqual(sandboxResult.actor, { kind: 'agent', id: agent });
      assert.equal(sandboxResult.taskId, staged.id);
      assert.equal(sandboxResult.eventId, event.id);
      assert.equal(sandboxResult.inputRef, manifest.proposalRef);
      assert.equal(sandboxResult.outputRef, artifacts[0].uri);
      const tail = json(['logs', 'tail', agent]);
      assert.ok(Array.isArray(tail));
      assert.deepEqual(
        tail.filter((entry: unknown) => record(entry) && entry.tool === 'sandbox.run'),
        sandboxAudit,
      );
      const originalReceipts = json(['event', 'list']);
      assert.equal(JSON.stringify(originalReceipts).includes(code), false);
      assert.equal(JSON.stringify(originalReceipts).includes('CHECK_OK'), false);
      const reviewed = entity([
        'task',
        'review',
        staged.id,
        '--decision',
        'approve',
        '--actor',
        'human',
        '--reason',
        'checked file',
        '--expected-version',
        String(staged.version),
      ]);
      await wait(() => {
        const memory = json(['memory', 'list']);
        return Array.isArray(memory) && memory.length === 1;
      });
      const memory = json(['memory', 'list']);
      assert.equal(run(['daemon', 'stop']).status, 0);
      await exited;
      child = undefined;
      await launch();
      assert.equal(entity(['task', 'get', staged.id]).version, reviewed.version);
      assert.deepEqual(json(['memory', 'list']), memory);
      assert.deepEqual(json(['event', 'list']), originalReceipts);
      const auditAfter = json(['audit', 'list']);
      assert.ok(Array.isArray(auditAfter));
      assert.deepEqual(
        auditAfter.filter(
          (entry: unknown): entry is Record<string, unknown> =>
            record(entry) && entry.tool === 'sandbox.run',
        ),
        sandboxAudit,
      );
      assert.equal(run(['daemon', 'stop']).status, 0);
      await exited;
      child = undefined;
    } finally {
      if (child) {
        run(['daemon', 'stop']);
        child.kill('SIGTERM');
        await exited;
      }
      rmSync(home, { recursive: true, force: true });
    }
  },
  30000,
);
