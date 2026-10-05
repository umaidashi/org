import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('scoped Runtime Workflow produces a verified Task artifact, human-reviewed Memory and bounded shutdown without credential leakage or replay', async () => {
  const home = mkdtempSync('/tmp/org-task-workflow-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    runtimeConfig = home + '/runtime.json',
    workflowConfig = home + '/workflow.json',
    driver = home + '/driver.ts';
  let invokes = 0,
    reads = 0,
    waiting = false;
  let release: (() => void) | undefined;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === '/webhook/check') {
        assert.equal(request.headers.get('X-N8N-API-KEY'), null);
        const input: unknown = await request.json();
        assert.ok(record(input));
        invokes++;
        if (input.wait === true) {
          waiting = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return Response.json({ executionId: '13' });
      }
      assert.equal(request.headers.get('X-N8N-API-KEY'), 'agent-fixture-key');
      reads++;
      return Response.json({
        id: '13',
        workflowId: 'flow',
        status: reads < 3 ? 'running' : 'success',
      });
    },
  });
  writeFileSync(
    driver,
    `#!${process.execPath}\nconst input=JSON.parse(await Bun.stdin.text());if(process.env.ORG_HOST_KEY||process.env.ORG_AGENT_A_KEY)throw new Error('Credential leaked into Runtime');if(!input.instruction.includes('read-only Workflow'))throw new Error('Missing native Workflow instruction');const proposal={version:1,tool:'workflow',workflowId:'flow',input:input.message.includes('manual.wait')?{wait:true}:{marker:'PRIVATE_INPUT'}};console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(proposal)}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
    { mode: 0o700 },
  );
  writeFileSync(
    runtimeConfig,
    JSON.stringify({
      codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
    }),
  );
  const env = {
    ...process.env,
    ORG_HOST_KEY: 'host-fixture-key',
    ORG_AGENT_A_KEY: 'agent-fixture-key',
  };
  const run = async (args: string[]): Promise<unknown> => {
    const child = spawn(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        ...(args.includes('--direct') ? [] : ['--socket', socket]),
        ...args,
        ...(args.includes('agent') && args.includes('create') ? [] : ['--json']),
      ],
      { env },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (value: Buffer) => {
      stdout += value.toString();
    });
    child.stderr.on('data', (value: Buffer) => {
      stderr += value.toString();
    });
    const status = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(status, 0, stderr);
    assert.ok(!/host-fixture-key|agent-fixture-key/.test(stdout + stderr));
    return args.includes('agent') && args.includes('create') ? stdout : JSON.parse(stdout);
  };
  const entity = async (args: string[]): Promise<Record<string, unknown> & { id: string }> => {
    const value = await run(args);
    assert.ok(record(value) && typeof value.id === 'string');
    return { ...value, id: value.id };
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  const findTask = async (eventId: string) => {
    const tasks = await run(['task', 'list']);
    assert.ok(Array.isArray(tasks));
    const task: unknown = tasks.find(
      (value: unknown) => record(value) && value.externalRef === 'org:event:' + eventId,
    );
    return record(task) ? task : undefined;
  };
  try {
    await run([
      '--direct',
      'agent',
      'create',
      'worker',
      '--role',
      'check',
      '--runtime',
      'codex',
      '--memory-policy',
      'reviewed-tasks',
      ...['can_read', 'can_delegate', 'can_access_network', 'can_contact_external'].flatMap(
        (capability) => ['--capability', capability],
      ),
    ]);
    const agents = await run(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(agents) && record(agents[0]) && typeof agents[0].id === 'string');
    const agent = { id: agents[0].id };
    writeFileSync(
      workflowConfig,
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${server.port}`,
        apiKeyEnv: 'ORG_HOST_KEY',
        workflows: [{ id: 'flow', path: 'check' }],
        agentScopes: [
          {
            agentId: agent.id,
            workflowIds: ['flow'],
            apiKeyEnv: 'ORG_AGENT_A_KEY',
            effect: 'read_only',
          },
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
      agent.id,
    ]);
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
        runtimeConfig,
        '--workflow-config',
        workflowConfig,
        '--wake-up',
        '--poll-interval',
        '20',
      ],
      { env },
    );
    exited = new Promise((resolve) => daemon?.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Workflow Task daemon not ready')), 5000);
      daemon?.stdout?.on('data', (value: Buffer) => {
        if (value.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const event = await entity(['event', 'publish', 'manual.check', '--source', 'manual']);
    let task = await findTask(event.id);
    const deadline = Date.now() + 5000;
    while (task?.status !== 'waiting_approval') {
      assert.ok(Date.now() < deadline, 'Task did not stage');
      await Bun.sleep(20);
      task = await findTask(event.id);
    }
    assert.ok(typeof task.id === 'string' && typeof task.version === 'number');
    const artifacts = await run(['task', 'artifacts', task.id]);
    assert.ok(
      Array.isArray(artifacts) &&
        artifacts.length === 1 &&
        record(artifacts[0]) &&
        typeof artifacts[0].id === 'string',
    );
    const artifact = await run([
      'task',
      'artifact-content',
      task.id,
      '--artifact',
      artifacts[0].id,
    ]);
    assert.ok(record(artifact) && typeof artifact.content === 'string');
    const manifest: unknown = JSON.parse(artifact.content);
    assert.ok(record(manifest) && typeof manifest.requestId === 'string');
    assert.equal(manifest.status, 'success');
    assert.ok(!artifact.content.includes('PRIVATE_INPUT'));
    const history = await run(['workflow', 'history', manifest.requestId]);
    assert.ok(Array.isArray(history) && history.length === 2);
    assert.ok(!JSON.stringify(history).includes('PRIVATE_INPUT'));
    await run([
      'task',
      'review',
      task.id,
      '--decision',
      'approve',
      '--actor',
      'human',
      '--reason',
      'verified Workflow artifact',
      '--expected-version',
      String(task.version),
    ]);
    let memories = await run(['memory', 'list']);
    const memoryDeadline = Date.now() + 5000;
    while (!Array.isArray(memories) || memories.length !== 1) {
      assert.ok(Date.now() < memoryDeadline);
      await Bun.sleep(20);
      memories = await run(['memory', 'list']);
    }
    const waitEvent = await entity(['event', 'publish', 'manual.wait', '--source', 'manual']);
    const waitDeadline = Date.now() + 5000;
    while (!waiting) {
      assert.ok(Date.now() < waitDeadline);
      await Bun.sleep(20);
    }
    const waitingTask = await findTask(waitEvent.id);
    assert.ok(waitingTask && typeof waitingTask.id === 'string');
    await run(['daemon', 'stop']);
    await exited;
    daemon = undefined;
    assert.equal((await entity(['--direct', 'task', 'get', waitingTask.id])).status, 'failed');
    const requests = await run(['--direct', 'workflow', 'list']);
    assert.ok(Array.isArray(requests) && requests.length === 2);
    const waitRequest: unknown = requests.find(
      (value: unknown) =>
        record(value) && record(value.payload) && value.payload.taskId === waitingTask.id,
    );
    assert.ok(record(waitRequest) && typeof waitRequest.id === 'string');
    const failedHistory = await run(['--direct', 'workflow', 'history', waitRequest.id]);
    assert.ok(
      Array.isArray(failedHistory) && failedHistory.length === 2 && record(failedHistory[1]),
    );
    assert.equal(failedHistory[1].type, 'workflow.unconfirmed');
    assert.equal(invokes, 2);
  } finally {
    release?.();
    daemon?.kill('SIGTERM');
    await exited;
    await server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
