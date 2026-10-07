import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

async function proof(
  auto: boolean,
  crash: boolean,
  artifactFailure: boolean,
  stageFailure: boolean,
): Promise<void> {
  const home = mkdtempSync('/tmp/org-approved-task-'),
    db = home + '/org.db',
    config = home + '/workflow.json',
    runtime = home + '/runtime.json',
    driver = home + '/driver.ts';
  const socket = home + '/org.sock';
  let invokes = 0,
    reads = 0,
    delayed = false,
    statusFailure = false,
    holdStatus = false;
  let releaseStatus: (() => void) | undefined;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === '/webhook/check') {
        assert.equal(request.headers.get('X-N8N-API-KEY'), null);
        invokes++;
        return Response.json({ executionId: String(13 + invokes) });
      }
      assert.equal(request.headers.get('X-N8N-API-KEY'), 'agent-fixture-key');
      reads++;
      if (holdStatus && reads >= 2)
        await new Promise<void>((resolve) => {
          releaseStatus = resolve;
        });
      if (statusFailure) return new Response('fixture failure', { status: 500 });
      return Response.json({
        id: new URL(request.url).pathname.split('/').at(-1),
        workflowId: 'flow',
        status: delayed ? 'waiting' : 'success',
      });
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
        ...(auto ? ['--observe-workflows'] : []),
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
        'can_publish',
        'can_spend',
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
        taskWaitTimeoutMs: crash ? 30000 : 200,
        workflows: [
          {
            id: 'flow',
            path: 'check',
            effect: 'write',
            requiredCapabilities: ['can_publish', 'can_spend'],
          },
        ],
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
    assert.ok(
      record(approvals[0].request.operation) && record(approvals[0].request.operation.binding),
    );
    assert.deepEqual(approvals[0].request.operation.binding.requiredCapabilities, [
      'can_publish',
      'can_spend',
    ]);
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
    if (crash) {
      holdStatus = true;
      const pending = raw([
        'task',
        'resume-workflow',
        taskId,
        '--approval',
        approval,
        '--expected-version',
        String(waitingVersion),
      ]);
      const deadline = Date.now() + 3000;
      while (reads < 2) {
        assert.ok(Date.now() < deadline, 'Workflow status not reached');
        await Bun.sleep(10);
      }
      daemon?.kill('SIGKILL');
      await exited;
      daemon = undefined;
      assert.notEqual((await pending).code, 0);
      releaseStatus?.();
      const configured: unknown = JSON.parse(await Bun.file(config).text());
      assert.ok(record(configured));
      writeFileSync(config, JSON.stringify({ ...configured, taskWaitTimeoutMs: 200 }));
      await start();
      const recovered = await entity(['task', 'get', taskId]);
      assert.equal(recovered.status, 'blocked');
      assert.equal(invokes, 1);
      holdStatus = false;
      releaseStatus?.();
      if (!auto)
        await entity([
          'task',
          'observe-workflow',
          taskId,
          '--expected-version',
          String(recovered.version),
        ]);
      const deadline2 = Date.now() + 3000;
      while ((await entity(['task', 'get', taskId])).status !== 'waiting_approval') {
        assert.ok(Date.now() < deadline2, 'Recovered result not observed');
        await Bun.sleep(10);
      }
    }
    if (artifactFailure || stageFailure) {
      if (artifactFailure) writeFileSync(db + '.artifacts', 'owned-storage-blocker');
      if (stageFailure) {
        const fault = new Database(db);
        fault.exec('PRAGMA busy_timeout=5000');
        try {
          fault.run(
            "CREATE TRIGGER owned_stage_fault BEFORE INSERT ON task_artifacts BEGIN SELECT RAISE(ABORT, 'owned stage fault'); END",
          );
        } finally {
          fault.close();
        }
      }
      const pending = await raw([
        'task',
        'resume-workflow',
        taskId,
        '--approval',
        approval,
        '--expected-version',
        String(waitingVersion),
      ]);
      assert.equal(pending.code, 1);
      await stop();
      const blocked = await entity(['--direct', 'task', 'get', taskId]);
      assert.equal(blocked.status, 'blocked');
      assert.match(pending.err, /(?:Artifact|result).*pending/);
      assert.deepEqual(blocked.outputArtifacts, []);
      assert.equal(invokes, 1);
      if (artifactFailure) unlinkSync(db + '.artifacts');
      if (stageFailure) {
        const fault = new Database(db);
        fault.exec('PRAGMA busy_timeout=5000');
        try {
          fault.run('DROP TRIGGER owned_stage_fault');
        } finally {
          fault.close();
        }
      }
      await start();
      if (!auto)
        await entity([
          'task',
          'observe-workflow',
          taskId,
          '--expected-version',
          String(blocked.version),
        ]);
      const deadline = Date.now() + 3000;
      while ((await entity(['task', 'get', taskId])).status !== 'waiting_approval') {
        assert.ok(Date.now() < deadline, 'Artifact retry did not complete');
        await Bun.sleep(10);
      }
    }
    const resumed = await entity(
      crash || artifactFailure || stageFailure
        ? ['task', 'get', taskId]
        : [
            'task',
            'resume-workflow',
            taskId,
            '--approval',
            approval,
            '--expected-version',
            String(waitingVersion),
          ],
    );
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
    delayed = true;
    const secondEvent = await entity(['event', 'publish', 'manual.delayed', '--source', 'human']);
    let second: Record<string, unknown> | undefined;
    const nextDeadline = Date.now() + 5000;
    while (!second || second.status !== 'waiting_approval') {
      assert.ok(Date.now() < nextDeadline, 'Delayed Task not waiting');
      await Bun.sleep(20);
      const list = await run(['task', 'list']);
      assert.ok(Array.isArray(list));
      const candidates: readonly unknown[] = list;
      second = candidates.find(
        (task): task is Record<string, unknown> =>
          record(task) && task.externalRef === 'org:event:' + secondEvent.id,
      );
    }
    assert.ok(typeof second.id === 'string' && typeof second.version === 'number');
    const secondApprovals = await run(['approval', 'list']);
    assert.ok(Array.isArray(secondApprovals));
    const approvalCandidates: readonly unknown[] = secondApprovals;
    const secondApproval = approvalCandidates.find(
      (a) => record(a) && record(a.request) && a.request.taskId === second.id,
    );
    assert.ok(
      record(secondApproval) &&
        record(secondApproval.request) &&
        typeof secondApproval.request.id === 'string',
    );
    await run([
      'approval',
      'decide',
      secondApproval.request.id,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'Check delayed local fixture',
    ]);
    assert.equal(
      (
        await raw([
          'task',
          'resume-workflow',
          second.id,
          '--approval',
          secondApproval.request.id,
          '--expected-version',
          String(second.version),
        ])
      ).code,
      1,
    );
    const blocked = await entity(['task', 'get', second.id]);
    assert.equal(blocked.status, 'blocked');
    assert.equal(invokes, 2);
    await stop();
    await start();
    assert.deepEqual(await entity(['task', 'get', second.id]), blocked);
    if (auto) {
      const originalHistory = await run(['task', 'history', second.id]);
      await Bun.sleep(120);
      assert.deepEqual(await entity(['task', 'get', second.id]), blocked);
      assert.deepEqual(await run(['task', 'history', second.id]), originalHistory);
      statusFailure = true;
      const independentEvent = await entity([
        'event',
        'publish',
        'manual.independent',
        '--source',
        'human',
      ]);
      const independentDeadline = Date.now() + 5000;
      let independent: Record<string, unknown> | undefined;
      while (!independent || independent.status !== 'waiting_approval') {
        assert.ok(Date.now() < independentDeadline, 'Observation failure starved independent Task');
        await Bun.sleep(20);
        const list = await run(['task', 'list']);
        assert.ok(Array.isArray(list));
        const candidates: readonly unknown[] = list;
        independent = candidates.find(
          (task): task is Record<string, unknown> =>
            record(task) && task.externalRef === 'org:event:' + independentEvent.id,
        );
      }
      assert.equal(invokes, 2);
      assert.deepEqual(await entity(['task', 'get', second.id]), blocked);
      statusFailure = false;
    }
    assert.equal(invokes, 2);
    delayed = false;
    let observed = auto
      ? await entity(['task', 'get', second.id])
      : await entity([
          'task',
          'observe-workflow',
          second.id,
          '--expected-version',
          String(blocked.version),
        ]);
    const observedDeadline = Date.now() + 5000;
    while (auto && observed.status !== 'waiting_approval') {
      assert.ok(Date.now() < observedDeadline, 'Workflow not automatically observed');
      await Bun.sleep(20);
      observed = await entity(['task', 'get', second.id]);
    }
    assert.equal(observed.status, 'waiting_approval');
    assert.ok(Array.isArray(observed.outputArtifacts) && observed.outputArtifacts.length === 1);
    assert.equal(invokes, 2);
    assert.equal(
      (
        await raw([
          'task',
          'observe-workflow',
          second.id,
          '--expected-version',
          String(blocked.version),
        ])
      ).code,
      1,
    );
    assert.equal(invokes, 2);
    await run([
      'task',
      'review',
      second.id,
      '--decision',
      'approve',
      '--actor',
      'founder',
      '--reason',
      'Verified delayed execution',
      '--expected-version',
      String(observed.version),
    ]);
    assert.equal((await entity(['task', 'get', second.id])).status, 'completed');
    await stop();
  } finally {
    if (daemon && daemon.exitCode === null) {
      daemon.kill('SIGTERM');
      await exited;
    }
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}
test.each([
  [false, false, false, false],
  [true, false, false, false],
  [false, true, false, false],
  [true, true, false, false],
  [false, false, true, false],
  [true, false, true, false],
  [false, false, false, true],
  [true, false, false, true],
])(
  'native daemon approves once then observes Workflow auto=%s crash=%s artifactFailure=%s stageFailure=%s without reinvoking',
  proof,
  20000,
);
