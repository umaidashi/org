import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { transitionSession } from '../src/sessions/domain.js';
import { Database } from 'bun:sqlite';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test.each([false, true])(
  'Session CLI recovers persisted Task replies and drains turns with blockedWriteFailure=%s',
  async (blockedWriteFailure) => {
    const home = mkdtempSync('/tmp/org-session-cli-');
    const db = join(home, 'org.db');
    const socket = join(home, 'org.sock');
    const executable = join(home, 'runtime.ts');
    const config = join(home, 'runtime.json');
    const marker = join(home, 'started');
    const taskTurns = join(home, 'task-turns');
    writeFileSync(taskTurns, '');
    writeFileSync(
      executable,
      `#!${process.execPath}\nconst input = JSON.parse(await Bun.stdin.text());
    if (input.message === 'task question') await Bun.write(${JSON.stringify(taskTurns)},(await Bun.file(${JSON.stringify(taskTurns)}).text())+'turn\\n');
    if (input.message === 'wait') { await Bun.write(${JSON.stringify(marker)}, 'ready'); setInterval(() => {}, 100); }
    else { if(input.message === 'task question' && JSON.parse(JSON.parse(input.instruction).instruction).task.objective !== 'Research options') throw new Error('Task objective missing'); if(input.message === 'room question' && !JSON.parse(input.instruction).memories.some(m=>m.content === 'Room practice')) throw new Error('Scoped Memory missing'); console.log(JSON.stringify({type:'thread.started',thread_id:'provider'})); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input.message}})); console.log(JSON.stringify({type:'turn.completed',usage:{}})); }\n`,
      { mode: 0o700 },
    );
    writeFileSync(
      config,
      JSON.stringify({
        codex: { executable, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
      }),
    );
    const run = (args: string[]) =>
      spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
        encoding: 'utf8',
        timeout: 10000,
      });
    const json = (args: string[]) => {
      const result = run([...args, '--json']);
      assert.equal(result.status, 0, result.stderr);
      const value: unknown = JSON.parse(result.stdout);
      return value;
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
      ]);
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      let error = '';
      child.stderr.on('data', (value: Buffer) => {
        error += value.toString();
      });
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Daemon not ready: ${error}`)), 5000);
        child.stdout.on('data', (value: Buffer) => {
          if (value.toString().includes('"ready"')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      return { child, exited, ready };
    };
    let daemon: ReturnType<typeof launch> | undefined;
    const pending: ReturnType<typeof spawn>[] = [];
    try {
      assert.equal(
        run([
          '--direct',
          'agent',
          'create',
          'chief',
          '--role',
          'Chief',
          '--runtime',
          'codex',
          '--capability',
          'can_read',
        ]).status,
        0,
      );
      const list = json(['--direct', 'agent', 'list']);
      assert.ok(Array.isArray(list) && record(list[0]) && typeof list[0].id === 'string');
      const room = json([
        '--direct',
        'room',
        'create',
        'work',
        '--type',
        'direct',
        '--human',
        'founder',
        '--agent',
        list[0].id,
      ]);
      assert.ok(record(room) && typeof room.id === 'string');
      const direct = run(['--direct', 'session', 'list']);
      assert.equal(direct.status, 2);
      daemon = launch();
      await daemon.ready;
      const start = json([
        '--socket',
        socket,
        'session',
        'start',
        '--agent',
        list[0].id,
        '--room',
        room.id,
        '--message',
        'first',
      ]);
      assert.ok(record(start) && record(start.session) && typeof start.session.id === 'string');
      const id = start.session.id;
      assert.equal(start.text, 'first');
      const resume = json(['--socket', socket, 'session', 'resume', id, '--message', 'again']);
      assert.ok(record(resume));
      assert.equal(resume.text, 'again');
      const source = json([
        '--socket',
        socket,
        'room',
        'send',
        room.id,
        '--human',
        'founder',
        '--content',
        'room question',
      ]);
      assert.ok(record(source) && typeof source.id === 'string');
      json([
        '--socket',
        socket,
        'memory',
        'capture',
        '--type',
        'procedural',
        '--scope',
        'room:' + room.id,
        '--room',
        room.id,
        '--message',
        source.id,
        '--confidence',
        '0.8',
        '--content',
        'Room practice',
      ]);
      const reply = json(['--socket', socket, 'session', 'reply', id, '--room-message', source.id]);
      assert.ok(record(reply) && typeof reply.id === 'string');
      assert.equal(reply.content, 'room question');
      assert.equal(reply.replyTo, source.id);
      const repeated = json([
        '--socket',
        socket,
        'session',
        'reply',
        id,
        '--room-message',
        source.id,
      ]);
      assert.ok(record(repeated));
      assert.equal(repeated.id, reply.id);
      const conversation = json(['--socket', socket, 'room', 'messages', room.id]);
      assert.ok(Array.isArray(conversation));
      assert.equal(conversation.length, 2);
      const task = json([
        '--socket',
        socket,
        'task',
        'create',
        'research',
        '--kind',
        'execution_task',
        '--objective',
        'Research options',
      ]);
      assert.ok(record(task) && typeof task.id === 'string');
      json(['--socket', socket, 'task', 'assign', task.id, '--owner', list[0].id]);
      const taskRoom = json([
        '--socket',
        socket,
        'room',
        'create',
        'task work',
        '--type',
        'task',
        '--task',
        task.id,
        '--human',
        'founder',
        '--agent',
        list[0].id,
      ]);
      assert.ok(record(taskRoom) && typeof taskRoom.id === 'string');
      const taskSession = json([
        '--socket',
        socket,
        'session',
        'start',
        '--agent',
        list[0].id,
        '--room',
        taskRoom.id,
        '--message',
        'ready',
      ]);
      assert.ok(
        record(taskSession) &&
          record(taskSession.session) &&
          typeof taskSession.session.id === 'string',
      );
      const taskMessage = json([
        '--socket',
        socket,
        'room',
        'send',
        taskRoom.id,
        '--human',
        'founder',
        '--content',
        'task question',
      ]);
      assert.ok(record(taskMessage) && typeof taskMessage.id === 'string');
      const fault = new Database(db);
      try {
        fault.run(
          "CREATE TRIGGER owned_runtime_stage_fault BEFORE INSERT ON task_artifacts BEGIN SELECT RAISE(ABORT, 'owned stage fault'); END",
        );
        if (blockedWriteFailure)
          fault.run(
            "CREATE TRIGGER owned_task_state_fault BEFORE UPDATE ON tasks WHEN json_extract(NEW.data,'$.status')='blocked' BEGIN SELECT RAISE(ABORT, 'owned state fault'); END",
          );
      } finally {
        fault.close();
      }
      const failedStage = run([
        '--socket',
        socket,
        'task',
        'run',
        task.id,
        '--session',
        taskSession.session.id,
        '--room-message',
        taskMessage.id,
      ]);
      assert.equal(failedStage.status, 1, failedStage.stderr);
      let blocked = json(['--socket', socket, 'task', 'get', task.id]);
      assert.ok(record(blocked) && typeof blocked.version === 'number');
      assert.equal(blocked.status, blockedWriteFailure ? 'running' : 'blocked');
      assert.deepEqual(blocked.outputArtifacts, []);
      assert.equal(readFileSync(taskTurns, 'utf8'), 'turn\n');
      const replies = json(['--socket', socket, 'room', 'messages', taskRoom.id]);
      assert.ok(Array.isArray(replies));
      const original: unknown = replies.find(
        (m: unknown) => record(m) && m.replyTo === taskMessage.id,
      );
      assert.ok(record(original) && typeof original.id === 'string' && record(original.metadata));
      assert.deepEqual(original.metadata.taskExecution, {
        taskId: task.id,
        version: blocked.version - (blockedWriteFailure ? 0 : 1),
      });
      assert.equal(
        run([
          '--socket',
          socket,
          'room',
          'send',
          taskRoom.id,
          '--agent',
          list[0].id,
          '--content',
          'forged',
          '--metadata',
          JSON.stringify({ taskExecution: { taskId: task.id, version: blocked.version - 1 } }),
        ]).status,
        2,
      );
      assert.equal(run(['daemon', 'stop', '--socket', socket]).status, 0);
      assert.equal(await daemon.exited, 0);
      daemon = undefined;
      const repaired = new Database(db);
      try {
        repaired.run('DROP TRIGGER owned_runtime_stage_fault');
        if (blockedWriteFailure) repaired.run('DROP TRIGGER owned_task_state_fault');
      } finally {
        repaired.close();
      }
      daemon = launch();
      await daemon.ready;
      blocked = json(['--socket', socket, 'task', 'get', task.id]);
      assert.ok(record(blocked) && typeof blocked.version === 'number');
      assert.equal(blocked.status, 'blocked');
      assert.equal(readFileSync(taskTurns, 'utf8'), 'turn\n');
      const execution = {
        task: json([
          '--socket',
          socket,
          'task',
          'recover-result',
          task.id,
          '--session',
          taskSession.session.id,
          '--room-message',
          original.id,
          '--expected-version',
          String(blocked.version),
        ]),
        reply: original,
      };
      assert.ok(record(execution.task) && record(execution.reply));
      assert.equal(execution.task.status, 'waiting_approval');
      assert.deepEqual(execution.task.outputArtifacts, [execution.reply.id]);
      assert.equal(execution.reply.content, 'task question');
      assert.equal(readFileSync(taskTurns, 'utf8'), 'turn\n');
      assert.equal(
        run([
          '--socket',
          socket,
          'task',
          'recover-result',
          task.id,
          '--session',
          taskSession.session.id,
          '--room-message',
          original.id,
          '--expected-version',
          String(blocked.version),
        ]).status,
        1,
      );
      const artifacts = json(['--socket', socket, 'task', 'artifacts', task.id]);
      assert.ok(Array.isArray(artifacts));
      assert.equal(artifacts.length, 1);
      assert.ok(record(artifacts[0]));
      assert.equal(artifacts[0].uri, `org://rooms/${taskRoom.id}/messages/${original.id}`);
      const content = json([
        '--socket',
        socket,
        'task',
        'artifact-content',
        task.id,
        '--artifact',
        original.id,
      ]);
      assert.ok(record(content));
      assert.equal(content.content, original.content);
      assert.equal(content.uri, artifacts[0].uri);
      assert.equal(readFileSync(taskTurns, 'utf8'), 'turn\n');
      const history = json(['--socket', socket, 'task', 'history', task.id]);
      assert.ok(Array.isArray(history));
      assert.ok(history.some((row: unknown) => record(row) && row.status === 'running'));
      const reviewed = json([
        '--socket',
        socket,
        'task',
        'review',
        task.id,
        '--decision',
        'approve',
        '--actor',
        'founder',
        '--reason',
        'Verified original saved reply',
        '--expected-version',
        String(execution.task.version),
      ]);
      assert.ok(record(reviewed));
      assert.equal(reviewed.status, 'completed');
      const preserved = json(['--socket', socket, 'room', 'messages', taskRoom.id]);
      assert.ok(Array.isArray(preserved));
      assert.deepEqual(
        preserved.find((m: unknown) => record(m) && m.id === original.id),
        original,
      );
      assert.equal(readFileSync(taskTurns, 'utf8'), 'turn\n');
      assert.equal(
        run([
          '--direct',
          'task',
          'run',
          task.id,
          '--session',
          taskSession.session.id,
          '--room-message',
          taskMessage.id,
        ]).status,
        2,
      );
      const beginWait = () => {
        const child = spawn(process.execPath, [
          '--no-env-file',
          cli,
          '--socket',
          socket,
          'session',
          'send',
          id,
          '--message',
          'wait',
          '--json',
        ]);
        pending.push(child);
        child.stdout.resume();
        child.stderr.resume();
        return new Promise<number | null>((resolve) => child.once('exit', resolve));
      };
      const waitForMarker = async () => {
        const until = Date.now() + 4000;
        while (!existsSync(marker)) {
          if (Date.now() > until) throw new Error('Runtime not started');
          await Bun.sleep(10);
        }
        unlinkSync(marker);
      };
      const sending = beginWait();
      await waitForMarker();
      const stopped = json(['--socket', socket, 'session', 'stop', id]);
      assert.ok(record(stopped));
      assert.equal(stopped.status, 'stopped');
      assert.equal(await sending, 1);
      assert.ok(Array.isArray(json(['--socket', socket, 'session', 'history', id])));
      const second = beginWait();
      await waitForMarker();
      assert.equal(run(['daemon', 'stop', '--socket', socket]).status, 0);
      assert.equal(await second, 1);
      assert.equal(await daemon.exited, 0);
      daemon = undefined;
      const store = new SqliteSessionStore(db);
      try {
        const current = store.get(id);
        store.save(transitionSession(current, { type: 'begin', at: 'restart' }), current.version);
      } finally {
        store.close();
      }
      daemon = launch();
      await daemon.ready;
      const recovered = json(['--socket', socket, 'session', 'get', id]);
      assert.ok(record(recovered));
      assert.equal(recovered.status, 'failed');
      assert.equal(recovered.providerSessionId, 'provider');
      json(['--socket', socket, 'session', 'stop', taskSession.session.id]);
      const records = json(['--direct', 'audit', 'list']);
      assert.ok(Array.isArray(records));
      const runtimeAudit = records.filter(
        (entry) =>
          entry.tool === 'session.runtime' && entry.inputRef.startsWith('org://session-inputs/'),
      );
      assert.ok(runtimeAudit.length >= 4);
      assert.ok(
        runtimeAudit.some(
          (entry) =>
            entry.taskId === task.id &&
            entry.actor.kind === 'agent' &&
            entry.actor.id === list[0].id,
        ),
      );
      assert.ok(runtimeAudit.some((entry) => entry.result === 'started'));
      assert.ok(runtimeAudit.some((entry) => entry.result === 'succeeded'));
      assert.ok(
        records.some((entry) => entry.tool === 'session.stop' && entry.result === 'canceled'),
      );
      for (const entry of runtimeAudit)
        assert.match(String(entry.inputRef), /^org:\/\/session-inputs\/[a-f0-9]{64}$/);
      assert.deepEqual(json(['--direct', 'audit', 'list']), records);
      const taskLogs = json(['--direct', 'logs', '--task', task.id, '--limit', '100']);
      assert.ok(Array.isArray(taskLogs));
      assert.ok(
        taskLogs.some(
          (entry) =>
            entry.tool === 'session.stop' &&
            entry.result === 'canceled' &&
            entry.taskId === task.id,
        ),
      );

      assert.equal(run(['daemon', 'stop', '--socket', socket]).status, 0);
      assert.equal(await daemon.exited, 0);
      daemon = undefined;
    } finally {
      if (daemon) {
        daemon.child.kill('SIGTERM');
        await daemon.exited;
      }
      for (const child of pending) if (child.exitCode === null) child.kill('SIGTERM');
      rmSync(home, { recursive: true, force: true });
    }
  },
  20000,
);
test('Runtime result recovery releases Room connection when Session initialization fails', () => {
  const home = mkdtempSync('/tmp/org-result-init-failure-');
  try {
    const fixture = join(home, 'fault.ts');
    writeFileSync(
      fixture,
      `
      import assert from 'node:assert/strict';
      import {Database} from 'bun:sqlite';
      import {SqliteRoomRepository} from ${JSON.stringify(new URL('../src/rooms/sqlite.ts', import.meta.url).href)};
      import {parseTaskCommand,runTaskCommand} from ${JSON.stringify(new URL('../src/tasks/cli.ts', import.meta.url).href)};
      const db=${JSON.stringify(join(home, 'org.db'))};
      const fault=new Database(db);
      fault.run("CREATE VIEW session_history AS SELECT 's' AS id,0 AS version,'{}' AS data");
      fault.close();
      let closes=0;
      const close=SqliteRoomRepository.prototype.close;
      SqliteRoomRepository.prototype.close=function(){closes++;close.call(this);};
      await assert.rejects(runTaskCommand(parseTaskCommand(['task','recover-result','t','--db',db,'--session','s','--room-message','m','--expected-version','1']),()=>{}));
      assert.equal(closes,1);
    `,
    );
    const child = spawnSync(process.execPath, ['--no-env-file', fixture], {
      env: { PATH: process.env.PATH ?? '', HOME: home },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
