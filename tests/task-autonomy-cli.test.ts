import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('Event subscription wakes assigned ExecutionTask with scoped Memory and stages one Artifact for explicit review without replay', async () => {
  const home = mkdtempSync('/tmp/org-task-autonomy-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    driver = home + '/driver.ts',
    config = home + '/config.json',
    count = home + '/turns';
  writeFileSync(count, '');
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';const input=JSON.parse(await Bun.stdin.text());const context=JSON.parse(input.instruction);const instruction=context.instruction?JSON.parse(context.instruction):null;if(instruction?.task){if(context.memories.some(m=>m.content==='FOREIGN_TASK')||(instruction.task.id==='a2a:scope-proof'&&!context.memories.some(m=>m.content==='TASK_SCOPE_OK'&&m.scope==='task:a2a:scope-proof'))||!instruction.task.id||(!context.memories.some(m=>m.content==='TASK_PRACTICE')||context.memories.some(m=>m.content==='DO_NOT_INCLUDE')))throw new Error('Missing Task or scoped Memory');appendFileSync(${JSON.stringify(count)},'turn\\n');if(input.message.includes('job.fail'))process.exit(1);}else if(!input.message.includes('"type":"result"')&&!input.message.includes('"type":"blocker"')&&!input.message.includes('"type":"decision"'))throw new Error('Expected delegation notification');console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Task complete'}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
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
    const r = run([...args, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const entity = (args: string[]): Record<string, unknown> & { id: string } => {
    const v = json(args);
    assert.ok(record(v) && typeof v.id === 'string');
    return { ...v, id: v.id };
  };
  const launch = () => {
    const child = spawn(process.execPath, [
      '--no-env-file',
      cli,
      '--db',
      db,
      'daemon',
      '--socket',
      socket,
      '--runtime-config',
      config,
      '--wake-up',
      '--poll-interval',
      '20',
    ]);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    let error = '';
    child.stderr.on('data', (v: Buffer) => {
      error += v.toString();
    });
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Not ready:' + error)), 5000);
      child.stdout.on('data', (v: Buffer) => {
        if (v.toString().includes('"ready"')) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    return { child, exited, ready };
  };
  const turns = () => readFileSync(count, 'utf8').trim().split('\n').filter(Boolean).length;
  const eventTask = (eventId: string) => {
    const all = json(['task', 'list']);
    assert.ok(Array.isArray(all));
    const v: unknown = all.find(
      (t: unknown) => record(t) && t.externalRef === 'org:event:' + eventId,
    );
    if (v === undefined) return undefined;
    assert.ok(record(v));
    return v;
  };
  const wait = async (check: () => boolean) => {
    const end = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > end) throw new Error('Timed out');
      await Bun.sleep(20);
    }
  };
  let daemon: ReturnType<typeof launch> | undefined;
  try {
    assert.equal(
      run(['--direct', 'agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'codex']).status,
      0,
    );
    const agents = json(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(agents) && record(agents[0]) && typeof agents[0].id === 'string');
    const chief = agents[0].id;
    const memoryRoom = entity([
      '--direct',
      'room',
      'create',
      'Memory evidence',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      chief,
    ]);
    const note = entity([
      '--direct',
      'room',
      'send',
      memoryRoom.id,
      '--human',
      'founder',
      '--content',
      'Memory proof',
    ]);
    entity([
      '--direct',
      'memory',
      'capture',
      '--type',
      'procedural',
      '--scope',
      'agent:' + chief,
      '--content',
      'TASK_PRACTICE',
      '--confidence',
      '1',
      '--room',
      memoryRoom.id,
      '--message',
      note.id,
    ]);
    for (const period of [
      ['--valid-until', '2000-01-01T00:00:00.000Z'],
      ['--valid-from', '2100-01-01T00:00:00.000Z'],
    ]) {
      entity([
        '--direct',
        'memory',
        'capture',
        '--type',
        'semantic',
        '--scope',
        'agent:' + chief,
        '--content',
        'DO_NOT_INCLUDE',
        '--confidence',
        '1',
        '--room',
        memoryRoom.id,
        '--message',
        note.id,
        ...period,
      ]);
    }
    assert.equal(run(['--direct', 'room', 'archive', memoryRoom.id]).status, 0);
    const work = entity([
      '--direct',
      'task',
      'create',
      'WorkItem',
      '--objective',
      'Never auto execute',
    ]);
    assert.equal(run(['--direct', 'task', 'assign', work.id, '--owner', chief]).status, 0);
    entity([
      '--direct',
      'event',
      'subscribe',
      'job.*',
      '--subscriber-type',
      'agent',
      '--subscriber',
      chief,
    ]);
    daemon = launch();
    await daemon.ready;
    const event = entity([
      'event',
      'publish',
      'job.ready',
      '--source',
      'manual',
      '--payload',
      '{"marker":"done"}',
    ]);
    await wait(() => eventTask(event.id)?.status === 'waiting_approval').catch(() => {
      assert.equal(eventTask(event.id)?.status, 'waiting_approval');
    });
    const task = eventTask(event.id);
    assert.ok(
      task &&
        typeof task.id === 'string' &&
        typeof task.version === 'number' &&
        Array.isArray(task.outputArtifacts),
    );
    assert.equal(task.owner, chief);
    assert.equal(task.outputArtifacts.length, 1);
    assert.equal(turns(), 1);
    const rooms = json(['room', 'list']);
    assert.ok(Array.isArray(rooms));
    const taskRoom: unknown = rooms.find((r: unknown) => record(r) && r.taskId === task.id);
    assert.ok(record(taskRoom) && typeof taskRoom.id === 'string');
    const messages = json(['room', 'messages', taskRoom.id]);
    assert.ok(Array.isArray(messages) && messages.length === 2);
    assert.ok(record(messages[1]));
    assert.equal(messages[1].content, 'Task complete');
    const reviewed = entity([
      'task',
      'review',
      task.id,
      '--decision',
      'approve',
      '--actor',
      'test-human',
      '--reason',
      'Marker checked',
      '--expected-version',
      String(task.version),
    ]);
    assert.equal(reviewed.status, 'completed');
    assert.equal(run(['daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    daemon = launch();
    await daemon.ready;
    const failedEvent = entity([
      'event',
      'publish',
      'job.fail',
      '--source',
      'manual',
      '--payload',
      '{}',
    ]);
    await wait(() => eventTask(failedEvent.id)?.status === 'failed');
    assert.equal(turns(), 2);
    const finalEvent = entity([
      'event',
      'publish',
      'job.final',
      '--source',
      'manual',
      '--payload',
      '{}',
    ]);
    await wait(() => eventTask(finalEvent.id)?.status === 'waiting_approval');
    assert.equal(turns(), 3);
    assert.equal(eventTask(event.id)?.status, 'completed');
    assert.equal(entity(['task', 'get', work.id]).status, 'assigned');
    assert.deepEqual(json(['room', 'messages', taskRoom.id]), messages);
    assert.equal(
      run([
        'agent',
        'create',
        'coordinator',
        '--role',
        'Coordinator',
        '--runtime',
        'codex',
        '--capability',
        'can_delegate',
      ]).status,
      0,
    );
    const allAgents = json(['agent', 'list']);
    assert.ok(Array.isArray(allAgents));
    const coordinator: unknown = allAgents.find(
      (a: unknown) => record(a) && a.name === 'coordinator',
    );
    assert.ok(record(coordinator) && typeof coordinator.id === 'string');
    const delegationRoom = entity([
      'room',
      'create',
      'Delegate',
      '--type',
      'agent',
      '--agent',
      coordinator.id,
      '--agent',
      chief,
    ]);
    const delegated = entity([
      'a2a',
      'send',
      delegationRoom.id,
      '--from',
      coordinator.id,
      '--to',
      chief,
      '--type',
      'delegate',
      '--task',
      work.id,
      '--payload',
      '{"objective":"Delegated marker"}',
    ]);
    const delegatedTaskId = 'a2a:' + delegated.id;
    await wait(() => {
      const all = json(['task', 'list']);
      assert.ok(Array.isArray(all));
      return all.some(
        (t: unknown) => record(t) && t.id === delegatedTaskId && t.status === 'waiting_approval',
      );
    }).catch(() => {
      const all = json(['task', 'list']);
      assert.ok(Array.isArray(all));
      assert.equal(
        all.some((t: unknown) => record(t) && t.id === delegatedTaskId),
        true,
        'delegate must create a Task',
      );
    });
    const delegatedTask = entity(['task', 'get', delegatedTaskId]);
    assert.equal(delegatedTask.status, 'waiting_approval');
    assert.equal(delegatedTask.owner, chief);
    assert.equal(delegatedTask.parentId, work.id);
    assert.equal(
      delegatedTask.externalRef,
      `org://rooms/${delegationRoom.id}/messages/${delegated.id}`,
    );
    assert.equal(turns(), 4);
    const sourceMessages = json(['room', 'messages', delegationRoom.id]);
    assert.ok(Array.isArray(sourceMessages));
    assert.ok(sourceMessages.length >= 1);
    await wait(() => {
      const all = json(['a2a', 'list', delegationRoom.id]);
      assert.ok(Array.isArray(all));
      return all.some(
        (message: unknown) =>
          record(message) && message.type === 'result' && message.replyTo === delegated.id,
      );
    });
    const returned = json(['a2a', 'list', delegationRoom.id]);
    assert.ok(Array.isArray(returned));
    const notification: unknown = returned.find(
      (message: unknown) => record(message) && message.type === 'result',
    );
    assert.ok(record(notification) && typeof notification.id === 'string');
    assert.equal(notification.from, chief);
    assert.equal(notification.to, coordinator.id);
    assert.equal(notification.taskId, work.id);
    assert.ok(record(notification.payload));
    assert.equal(notification.payload.executionTaskId, delegatedTaskId);
    assert.deepEqual(notification.payload.outputArtifacts, delegatedTask.outputArtifacts);
    await wait(() => {
      const all = json(['room', 'messages', delegationRoom.id]);
      assert.ok(Array.isArray(all));
      return all.some((message: unknown) => record(message) && message.replyTo === notification.id);
    });
    const completed = entity([
      'task',
      'review',
      delegatedTaskId,
      '--decision',
      'approve',
      '--actor',
      'test-human',
      '--reason',
      'Delegate marker checked',
      '--expected-version',
      String(delegatedTask.version),
    ]);
    assert.equal(completed.status, 'completed');
    await wait(() => {
      const all = json(['a2a', 'list', delegationRoom.id]);
      assert.ok(Array.isArray(all));
      return all.some((message: unknown) => record(message) && message.type === 'decision');
    });
    const withDecision = json(['a2a', 'list', delegationRoom.id]);
    assert.ok(Array.isArray(withDecision));
    const decision: unknown = withDecision.find(
      (message: unknown) => record(message) && message.type === 'decision',
    );
    assert.ok(record(decision) && typeof decision.id === 'string' && record(decision.payload));
    assert.equal(decision.from, chief);
    assert.equal(decision.to, coordinator.id);
    assert.equal(decision.replyTo, delegated.id);
    assert.equal(decision.correlationId, delegated.id);
    assert.ok(record(decision.payload.review));
    assert.equal(decision.payload.review.actor, 'test-human');
    assert.equal(decision.payload.review.decision, 'approve');
    await wait(() => {
      const all = json(['room', 'messages', delegationRoom.id]);
      assert.ok(Array.isArray(all));
      return all.some((message: unknown) => record(message) && message.replyTo === decision.id);
    });
    assert.equal(run(['daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    daemon = launch();
    await daemon.ready;
    await Bun.sleep(100);
    assert.equal(entity(['task', 'get', delegatedTaskId]).version, completed.version);
    assert.equal(turns(), 4);
    assert.deepEqual(json(['a2a', 'list', delegationRoom.id]), withDecision);
    entity([
      'event',
      'subscribe',
      'schedule.pulse',
      '--subscriber-type',
      'agent',
      '--subscriber',
      chief,
    ]);
    const schedule = entity([
      'schedule',
      'create',
      'Pulse',
      '--every-ms',
      '60000',
      '--start-at',
      new Date(Date.now() + 100).toISOString(),
      '--event',
      'schedule.pulse',
    ]);
    const slotId = `schedule:${schedule.id.length}:${schedule.id}:0`;
    await wait(() => eventTask(slotId)?.status === 'waiting_approval');
    const scheduledTask = eventTask(slotId);
    assert.ok(scheduledTask && Array.isArray(scheduledTask.outputArtifacts));
    assert.equal(scheduledTask.owner, chief);
    assert.equal(scheduledTask.outputArtifacts.length, 1);
    assert.equal(turns(), 5);
    const scheduleEvents = json(['event', 'list']);
    assert.equal(run(['schedule', 'disable', schedule.id]).status, 0);
    assert.equal(run(['daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    daemon = launch();
    await daemon.ready;
    await Bun.sleep(100);
    assert.deepEqual(json(['event', 'list']), scheduleEvents);
    assert.equal(turns(), 5);
    assert.equal(eventTask(slotId)?.version, scheduledTask.version);
    const scopeTasks = new SqliteTaskProvider(db);
    try {
      scopeTasks.create(
        createTask(
          {
            title: 'Namespaced scope',
            objective: 'Check exact Task Memory',
            kind: 'execution_task',
          },
          { id: 'a2a:scope-proof', createdAt: new Date().toISOString() },
        ),
      );
      for (const [scope, content] of [
        ['task:a2a:scope-proof', 'TASK_SCOPE_OK'],
        ['task:a2a:other', 'FOREIGN_TASK'],
      ]) {
        assert.ok(scope && content);
        entity([
          'memory',
          'capture',
          '--type',
          'semantic',
          '--scope',
          scope,
          '--content',
          content,
          '--confidence',
          '1',
          '--room',
          memoryRoom.id,
          '--message',
          note.id,
        ]);
      }
      scopeTasks.update('a2a:scope-proof', { owner: chief }, new Date().toISOString());
    } finally {
      scopeTasks.close();
    }
    await wait(() => entity(['task', 'get', 'a2a:scope-proof']).status === 'waiting_approval');
    assert.equal(turns(), 6);
  } finally {
    if (daemon) {
      spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
        timeout: 5000,
      });
      daemon.child.kill('SIGTERM');
      await daemon.exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
