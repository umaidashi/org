import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertUniqueDelegation(
  tasks: readonly Record<string, unknown>[],
  reference: string,
): void {
  assert.equal(tasks.filter((t) => t.externalRef === reference).length, 1);
}
async function waitForProjection<T>(
  read: () => T | undefined,
  clock = { now: () => performance.now(), sleep: () => Bun.sleep(50) },
): Promise<T> {
  const deadline = clock.now() + 130000;
  while (clock.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await clock.sleep();
  }
  throw Error('expected daemon projection');
}
test('real proof uniqueness guard rejects duplicate delegation with distinct Task IDs', () => {
  assert.throws(() =>
    assertUniqueDelegation(
      [
        { id: 'a', externalRef: 'delegate' },
        { id: 'b', externalRef: 'delegate' },
      ],
      'delegate',
    ),
  );
});
test('real proof polling permits a result at the configured 120 second Runtime boundary', async () => {
  let time = 0;
  assert.equal(
    await waitForProjection(() => (time >= 120000 ? 'ready' : undefined), {
      now: () => time,
      sleep: async () => {
        time += 100;
      },
    }),
    'ready',
  );
});
function assertSpecialistResult(content: string): void {
  assert.equal(content.trim(), 'RESULT_42');
}
test('real proof rejects incorrect results containing the expected token', () => {
  assert.throws(() => assertSpecialistResult('NOT_RESULT_42'));
});
async function proof() {
  const home = mkdtempSync('/tmp/org-a2a-proposal-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
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
      { encoding: 'utf8', timeout: 130000 },
    );
  const json = (args: string[]): unknown => {
    const r = run([...args, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const entity = (args: string[]): Record<string, unknown> & { id: string } => {
    const v = json(args);
    assert.ok(record(v) && typeof v.id === 'string');
    return { ...v, id: v.id };
  };
  const list = (args: string[]) => {
    const v = json(args);
    assert.ok(Array.isArray(v));
    return Array.from(v, (item: unknown) => {
      assert.ok(record(item));
      return item;
    });
  };
  let delegationRoom: string | undefined;
  let daemon: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  const launch = async () => {
    daemon = spawn(process.execPath, [
      '--no-env-file',
      cli,
      '--db',
      db,
      'daemon',
      '--socket',
      socket,
      '--runtime-config',
      home + '/runtime.json',
      '--wake-up',
      ...(delegationRoom === undefined ? [] : ['--delegation-room', delegationRoom]),
      '--poll-interval',
      '20',
    ]);
    exited = new Promise((r) => daemon?.once('exit', r));
    const child = daemon;
    let error = '';
    child.stderr?.on('data', (b: Buffer) => {
      error += b.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(error || 'not ready')), 5000);
      child.stdout?.on('data', (b: Buffer) => {
        if (b.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  };
  const wait = waitForProjection;
  try {
    assert.equal(
      run([
        '--direct',
        'agent',
        'create',
        'Chief',
        '--role',
        'chief',
        '--runtime',
        'claude',
        '--capability',
        'can_read',
        '--capability',
        'can_write',
        '--capability',
        'can_delegate',
      ]).status,
      0,
    );
    assert.equal(
      run([
        '--direct',
        'agent',
        'create',
        'Specialist',
        '--role',
        'research',
        '--runtime',
        'claude',
        '--memory-policy',
        'reviewed-tasks',
      ]).status,
      0,
    );
    const agents = list(['--direct', 'agent', 'list']);
    const chief = agents.find((a) => a.name === 'Chief'),
      worker = agents.find((a) => a.name === 'Specialist');
    assert.ok(chief && worker && typeof chief.id === 'string' && typeof worker.id === 'string');
    json(['--direct', 'agent', 'report', worker.id, '--to', chief.id]);
    const room = entity([
      '--direct',
      'room',
      'create',
      'Company',
      '--type',
      'group',
      '--human',
      'founder',
      '--agent',
      chief.id,
      '--agent',
      worker.id,
      '--coordinator',
      chief.id,
    ]);
    delegationRoom = room.id;
    const proposal = JSON.stringify({
      version: 1,
      tool: 'a2a',
      type: 'delegate',
      to: worker.id,
      payload: {
        objective:
          'Use only supplied information. Calculate 6 * 7 and reply exactly RESULT_42. Do not use tools or external services.',
      },
    });
    const executable = Bun.which('claude');
    assert.ok(executable, 'Claude CLI must be installed for opt-in real test');
    writeFileSync(
      home + '/runtime.json',
      JSON.stringify({
        claude: {
          executable,
          cwd: home,
          env: ['PATH', 'HOME', 'USER', 'LOGNAME'],
          timeoutMs: 120000,
          maxOutputBytes: 65536,
        },
      }),
      { mode: 0o600 },
    );
    await launch();
    const source = entity([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'Return only the exact JSON object without markdown for delegation to your direct specialist: ' +
        proposal,
    ]);
    const original = await wait(() =>
      list(['room', 'messages', room.id]).find(
        (m) => m.replyTo === source.id && record(m.sender) && m.sender.id === chief.id,
      ),
    );
    assert.ok(typeof original.id === 'string');
    assert.equal(typeof original.content, 'string');
    assert.deepEqual(JSON.parse(String(original.content)), JSON.parse(proposal));
    const adopted = await wait(() =>
      list(['a2a', 'list', room.id]).find((m) => m.type === 'delegate'),
    );
    assert.ok(typeof adopted.id === 'string');
    const adoptedId = adopted.id;
    assert.equal(adopted.from, chief.id);
    assert.equal(adopted.to, worker.id);
    const task = await wait(() =>
      list(['task', 'list']).find(
        (t) =>
          t.externalRef === `org://rooms/${room.id}/messages/${adoptedId}` &&
          t.status === 'waiting_approval',
      ),
    );
    assert.ok(typeof task.id === 'string' && typeof task.version === 'number');
    assert.equal(task.owner, worker.id);
    const taskRoom = list(['room', 'list']).find((r) => r.taskId === task.id);
    assert.ok(taskRoom && typeof taskRoom.id === 'string');
    const artifacts = list(['task', 'artifacts', task.id]);
    assert.equal(artifacts.length, 1);
    const artifact = artifacts[0];
    assert.ok(artifact && typeof artifact.id === 'string');
    const output = list(['room', 'messages', taskRoom.id]).find((m) => m.id === artifact.id);
    assert.ok(output && typeof output.content === 'string');
    assertSpecialistResult(output.content);
    assert.ok(record(output.sender));
    assert.equal(output.sender.id, worker.id);
    const chiefSession = list(['session', 'list']).find(
      (s) => s.agentId === chief.id && s.roomId === room.id,
    );
    assert.ok(chiefSession && typeof chiefSession.id === 'string');
    const provider = chiefSession.providerSessionId;
    assert.equal(typeof provider, 'string');
    assert.ok(
      list(['session', 'list']).some((s) => s.agentId === worker.id && s.runtime === 'claude'),
    );
    assert.equal(chiefSession.runtime, 'claude');
    json([
      'task',
      'review',
      task.id,
      '--decision',
      'approve',
      '--actor',
      'founder',
      '--reason',
      'Verified native specialist Artifact RESULT_42',
      '--expected-version',
      String(task.version),
    ]);
    const decision = await wait(() =>
      list(['a2a', 'list', room.id]).find((m) => m.type === 'decision' && m.replyTo === adopted.id),
    );
    assert.ok(typeof decision.id === 'string');
    const ack = await wait(() =>
      list(['room', 'messages', room.id]).find(
        (m) => m.replyTo === decision.id && record(m.sender) && m.sender.id === chief.id,
      ),
    );
    assert.ok(record(ack.metadata));
    assert.equal(ack.metadata.sessionId, chiefSession.id);
    const continued = entity(['session', 'get', chiefSession.id]);
    assert.equal(continued.providerSessionId, provider);
    assert.equal(continued.status, 'idle');
    const memory = await wait(() =>
      list(['memory', 'list', '--scope', 'task:' + task.id]).find((m) => m.type === 'episodic'),
    );
    assert.ok(typeof memory.id === 'string');
    const reviews = list(['task', 'reviews', task.id]);
    assert.equal(reviews.length, 1);
    const review = reviews[0];
    assert.ok(review && typeof review.id === 'string');
    assert.deepEqual(memory.sourceRefs, [
      {
        uri:
          'org://tasks/' +
          encodeURIComponent(task.id) +
          '/reviews/' +
          encodeURIComponent(review.id),
      },
    ]);
    json(['daemon', 'stop']);
    await exited;
    daemon = undefined;
    await launch();
    assert.deepEqual(entity(['a2a', 'adopt', room.id, '--message', original.id]), adopted);
    assertUniqueDelegation(list(['task', 'list']), `org://rooms/${room.id}/messages/${adoptedId}`);
    assert.deepEqual(list(['memory', 'list', '--scope', 'task:' + task.id]), [memory]);
    assert.equal(list(['a2a', 'list', room.id]).filter((m) => m.type === 'decision').length, 1);
    assert.equal(list(['a2a', 'list', room.id]).filter((m) => m.id === adopted.id).length, 1);
    assert.equal(
      list(['room', 'messages', room.id]).find((m) => m.id === original.id)?.content,
      original.content,
    );
  } finally {
    if (daemon) {
      run(['daemon', 'stop']);
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}
test.skipIf(process.env.ORG_CLAUDE_DELEGATION_TEST !== '1')(
  'real Claude Coordinator and specialist preserve Artifact review Memory and same provider session across restart',
  proof,
  360000,
);
