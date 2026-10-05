import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

test('native daemon write proposal waits, survives restart and resumes once with exact human approval and Agent credential', async () => {
  const home = mkdtempSync('/tmp/org-approved-task-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    config = home + '/workflow.json',
    runtime = home + '/runtime.json',
    driver = home + '/driver.ts';
  let invokes = 0,
    reads = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      if (new URL(request.url).pathname === '/webhook/check') {
        assert.equal(request.headers.get('X-N8N-API-KEY'), null);
        invokes++;
        return Response.json({ executionId: '14' });
      }
      assert.equal(request.headers.get('X-N8N-API-KEY'), 'agent-fixture-key');
      reads++;
      return Response.json({ id: '14', workflowId: 'flow', status: 'success' });
    },
  });
  const env = {
    ...process.env,
    ORG_HOST_KEY: 'host-fixture-key',
    ORG_AGENT_KEY: 'agent-fixture-key',
  };
  const raw = async (args: string[]) => {
    const child = spawn(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        ...(args.includes('--direct') ? [] : ['--socket', socket]),
        ...args,
      ],
      { env },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      err += c.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    clearTimeout(timer);
    return { code, out, err };
  };
  const run = async (args: string[]): Promise<unknown> => {
    const v = await raw([...args, '--json']);
    assert.equal(v.code, 0, v.err);
    return JSON.parse(v.out);
  };
  const entity = async (args: string[]) => {
    const v = await run(args);
    assert.ok(record(v));
    return v;
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<number | null> | undefined;
  const start = async () => {
    daemon = spawn(
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
        '--workflow-config',
        config,
        '--wake-up',
        '--poll-interval',
        '20',
      ],
      { env },
    );
    exited = new Promise((resolve) => daemon?.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      let out = '',
        err = '';
      const timer = setTimeout(() => reject(new Error('Daemon not ready: ' + err)), 5000);
      daemon?.stderr?.on('data', (c: Buffer) => {
        err += c.toString();
      });
      daemon?.stdout?.on('data', (c: Buffer) => {
        out += c.toString();
        if (out.includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      daemon?.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(err));
      });
    });
  };
  const stop = async () => {
    await raw(['daemon', 'stop']);
    assert.equal(await exited, 0);
    daemon = undefined;
  };
  try {
    writeFileSync(
      driver,
      `#!${process.execPath}\nconst input=JSON.parse(await Bun.stdin.text());if(process.env.ORG_AGENT_KEY||process.env.ORG_HOST_KEY)throw new Error('Credential leaked');console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({version:1,tool:'workflow',workflowId:'flow',input:{marker:'test'}})}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
      { mode: 0o700 },
    );
    writeFileSync(
      runtime,
      JSON.stringify({
        codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
      }),
    );
    const created = await raw([
      '--direct',
      'agent',
      'create',
      'worker',
      '--role',
      'check',
      '--runtime',
      'codex',
      ...[
        'can_read',
        'can_delegate',
        'can_access_network',
        'can_contact_external',
        'can_write',
      ].flatMap((c) => ['--capability', c]),
    ]);
    assert.equal(created.code, 0, created.err);
    const agents = await run(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(agents) && record(agents[0]) && typeof agents[0].id === 'string');
    const owner = agents[0].id;
    writeFileSync(
      config,
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${server.port}`,
        apiKeyEnv: 'ORG_HOST_KEY',
        workflows: [{ id: 'flow', path: 'check', effect: 'write' }],
        agentScopes: [
          { agentId: owner, workflowIds: ['flow'], apiKeyEnv: 'ORG_AGENT_KEY', effect: 'write' },
        ],
      }),
    );
    await run([
      '--direct',
      'event',
      'subscribe',
      'manual.*',
      '--subscriber-type',
      'agent',
      '--subscriber',
      owner,
    ]);
    await start();
    await entity(['event', 'publish', 'manual.check', '--source', 'human']);
    let task: Record<string, unknown> | undefined;
    const deadline = Date.now() + 5000;
    while (!task || task.status !== 'waiting_approval') {
      assert.ok(Date.now() < deadline, 'Task not waiting');
      await Bun.sleep(20);
      const tasks = await run(['task', 'list']);
      assert.ok(Array.isArray(tasks));
      task = tasks.find(record);
    }
    assert.ok(typeof task.id === 'string' && typeof task.version === 'number');
    const taskId = task.id,
      waitingVersion = task.version;
    assert.deepEqual(task.outputArtifacts, []);
    assert.equal(invokes, 0);
    assert.equal(reads, 0);
    const approvals = await run(['approval', 'list']);
    assert.ok(
      Array.isArray(approvals) &&
        record(approvals[0]) &&
        record(approvals[0].request) &&
        typeof approvals[0].request.id === 'string',
    );
    const approval = approvals[0].request.id;
    assert.equal(
      (
        await raw([
          'task',
          'resume-workflow',
          taskId,
          '--approval',
          approval,
          '--expected-version',
          String(waitingVersion),
        ])
      ).code,
      1,
    );
    assert.equal(invokes, 0);
    assert.equal(
      (
        await raw([
          'task',
          'review',
          taskId,
          '--decision',
          'approve',
          '--actor',
          'founder',
          '--reason',
          'proposal only',
          '--expected-version',
          String(waitingVersion),
        ])
      ).code,
      1,
    );
    await run([
      'approval',
      'decide',
      approval,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'Exact proposal checked',
    ]);
    await stop();
    await start();
    assert.deepEqual(await entity(['task', 'get', taskId]), task);
    assert.equal(invokes, 0);
    const resumed = await entity([
      'task',
      'resume-workflow',
      taskId,
      '--approval',
      approval,
      '--expected-version',
      String(waitingVersion),
    ]);
    assert.equal(resumed.status, 'waiting_approval');
    assert.ok(Array.isArray(resumed.outputArtifacts) && resumed.outputArtifacts.length === 1);
    assert.equal(invokes, 1);
    assert.ok(reads >= 1);
    assert.equal(
      (
        await raw([
          'task',
          'resume-workflow',
          taskId,
          '--approval',
          approval,
          '--expected-version',
          String(waitingVersion),
        ])
      ).code,
      1,
    );
    assert.equal(invokes, 1);
    await run([
      'task',
      'review',
      taskId,
      '--decision',
      'approve',
      '--actor',
      'founder',
      '--reason',
      'Verified execution artifact',
      '--expected-version',
      String(resumed.version),
    ]);
    assert.equal((await entity(['task', 'get', taskId])).status, 'completed');
    const audit = await run(['audit', 'list']);
    assert.ok(Array.isArray(audit));
    assert.ok(
      audit.some(
        (e) =>
          record(e) &&
          e.approvalId === approval &&
          e.tool === 'workflow.invoke' &&
          e.result === 'started',
      ),
    );
    await stop();
  } finally {
    if (daemon && daemon.exitCode === null) {
      daemon.kill('SIGTERM');
      await exited;
    }
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
