import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('Agent send CLI rejects malformed requests and direct execution before creating storage', () => {
  const home = mkdtempSync('/tmp/org-agent-send-parser-');
  const db = home + '/not-created.db';
  try {
    for (const [expected, args] of [
      [2, ['agent', 'send', 'agent', 'Message']],
      [2, ['agent', 'send', 'agent', ' ', '--room', 'room', '--human', 'human']],
      [
        2,
        [
          'agent',
          'send',
          'agent',
          'Message',
          '--room',
          'room',
          '--human',
          'human',
          '--role',
          'worker',
        ],
      ],
      [1, ['agent', 'send', 'agent', 'Message', '--room', 'room', '--human', 'human']],
    ] as const) {
      const result = spawnSync(
        process.execPath,
        ['--no-env-file', cli, '--db', db, '--direct', ...args],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, expected, result.stderr);
      assert.equal(result.stdout, '');
      assert.equal(existsSync(db), false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('Room activation runs only the coordinator or explicit Agent, reuses provider Session and persists replies without duplicate turns', async () => {
  const home = mkdtempSync('/tmp/org-room-wake-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    count = home + '/turns',
    config = home + '/config.json',
    driver = home + '/driver.ts';
  writeFileSync(count, '');
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'; const input = JSON.parse(await Bun.stdin.text()); const context = JSON.parse(input.instruction); if (!context.messages.some(m=>m.content===input.message)) throw new Error('Missing source context'); appendFileSync(${JSON.stringify(count)}, 'turn\\n'); if(input.message==='fail') process.exit(1); console.log(JSON.stringify({type:'thread.started',thread_id:'provider'})); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Answer:'+input.message}})); console.log(JSON.stringify({type:'turn.completed',usage:{}}));\n`,
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
      { encoding: 'utf8', timeout: 10000 },
    );
  const daemon = spawn(process.execPath, [
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
  const exited = new Promise((resolve) => daemon.once('exit', resolve));
  let error = '';
  daemon.stderr.on('data', (value: Buffer) => {
    error += value.toString();
  });
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
  const turns = () => readFileSync(count, 'utf8').trim().split('\n').filter(Boolean).length;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready:' + error)), 5000);
      daemon.stdout.on('data', (value: Buffer) => {
        if (value.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    for (const name of ['chief', 'cto'])
      assert.equal(
        run([
          'agent',
          'create',
          name,
          '--role',
          name,
          '--runtime',
          'codex',
          '--capability',
          'can_read',
        ]).status,
        0,
      );
    const agents = json(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const id = (name: string) => {
      const value: unknown = agents.find((a: unknown) => record(a) && a.name === name);
      assert.ok(record(value) && typeof value.id === 'string');
      return value.id;
    };
    const chief = id('chief'),
      cto = id('cto');
    const room = entity([
      'room',
      'create',
      'Company',
      '--type',
      'group',
      '--human',
      'founder',
      '--agent',
      chief,
      '--agent',
      cto,
      '--coordinator',
      chief,
    ]);
    const source = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'Question']);
    const activate = (message: string) => json(['room', 'activate', room.id, '--message', message]);
    const first = activate(source.id);
    assert.ok(Array.isArray(first) && first.length === 1);
    const reply: unknown = first[0];
    assert.ok(record(reply) && record(reply.sender) && record(reply.metadata));
    assert.equal(reply.sender.id, chief);
    assert.equal(reply.content, 'Answer:Question');
    assert.equal(reply.replyTo, source.id);
    assert.equal(turns(), 1);
    assert.deepEqual(activate(source.id), first);
    assert.equal(turns(), 1);
    const sessions = json(['session', 'list']);
    assert.ok(Array.isArray(sessions) && sessions.length === 1);
    const session: unknown = sessions[0];
    assert.ok(record(session) && typeof session.id === 'string');
    assert.equal(session.agentId, chief);
    assert.equal(session.providerSessionId, 'provider');
    assert.equal(session.status, 'idle');
    const second = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'Again']);
    activate(second.id);
    assert.equal(turns(), 2);
    const reused = json(['session', 'list']);
    assert.ok(Array.isArray(reused) && reused.length === 1);
    assert.ok(record(reused[0]));
    assert.equal(reused[0].id, session.id);
    assert.equal(reused[0].providerSessionId, 'provider');
    const directed = entity([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'Ask CTO',
      '--mention',
      cto,
    ]);
    activate(directed.id);
    assert.equal(turns(), 3);
    const a2a = entity([
      'a2a',
      'send',
      room.id,
      '--from',
      chief,
      '--to',
      cto,
      '--type',
      'request',
      '--payload',
      '{}',
    ]);
    activate(a2a.id);
    assert.equal(turns(), 4);
    const ordinary = entity(['room', 'send', room.id, '--agent', chief, '--content', 'Ordinary']);
    assert.deepEqual(activate(ordinary.id), []);
    assert.equal(turns(), 4);
    const failing = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'fail']);
    assert.equal(run(['room', 'activate', room.id, '--message', failing.id]).status, 1);
    assert.equal(turns(), 5);
    const failed = json(['session', 'get', session.id]);
    assert.ok(record(failed));
    assert.equal(failed.status, 'failed');
    const messages = json(['--direct', 'room', 'messages', room.id]);
    assert.ok(Array.isArray(messages));
    assert.equal(messages.filter((m: unknown) => record(m) && m.replyTo === failing.id).length, 0);
    assert.equal(run(['--direct', 'room', 'activate', room.id, '--message', source.id]).status, 1);
    const sent = json([
      'agent',
      'send',
      cto,
      'Direct request',
      '--room',
      room.id,
      '--human',
      'founder',
    ]);
    assert.ok(
      record(sent) &&
        record(sent.message) &&
        typeof sent.message.id === 'string' &&
        Array.isArray(sent.replies),
    );
    assert.equal(sent.replies.length, 1);
    assert.ok(record(sent.replies[0]) && record(sent.replies[0].sender));
    assert.equal(sent.replies[0].sender.id, cto);
    assert.equal(sent.replies[0].content, 'Answer:Direct request');
    assert.equal(sent.replies[0].replyTo, sent.message.id);
    assert.equal(turns(), 6);
    assert.deepEqual(activate(sent.message.id), sent.replies);
    assert.equal(turns(), 6);
    assert.deepEqual(json(['session', 'get', session.id]), failed);
    const ctoSessions = json(['session', 'list']);
    assert.ok(Array.isArray(ctoSessions));
    const ctoSession: unknown = ctoSessions.find(
      (value: unknown) => record(value) && value.agentId === cto,
    );
    assert.ok(record(ctoSession) && typeof ctoSession.id === 'string');
    const again = json([
      'agent',
      'send',
      cto,
      'Follow up',
      '--room',
      room.id,
      '--human',
      'founder',
    ]);
    assert.ok(
      record(again) &&
        Array.isArray(again.replies) &&
        record(again.replies[0]) &&
        record(again.replies[0].metadata),
    );
    assert.equal(again.replies[0].metadata.sessionId, ctoSession.id);
    assert.equal(turns(), 7);
    const beforeInvalid = json(['room', 'messages', room.id]);
    for (const args of [
      ['agent', 'send', 'missing', 'No', '--room', room.id, '--human', 'founder'],
      ['agent', 'send', cto, 'No', '--room', room.id, '--human', 'outsider'],
      ['--direct', 'agent', 'send', cto, 'No', '--room', room.id, '--human', 'founder'],
    ])
      assert.equal(run(args).status, 1);
    assert.deepEqual(json(['room', 'messages', room.id]), beforeInvalid);
    assert.equal(turns(), 7);
    const sendFailure = run([
      'agent',
      'send',
      cto,
      'fail',
      '--room',
      room.id,
      '--human',
      'founder',
    ]);
    assert.equal(sendFailure.status, 1);
    const stored = json(['--direct', 'room', 'messages', room.id]);
    assert.ok(Array.isArray(stored));
    const failedSource: unknown = stored.find(
      (value: unknown) => record(value) && value.content === 'fail' && value.id !== failing.id,
    );
    assert.ok(record(failedSource) && typeof failedSource.id === 'string');
    assert.ok(sendFailure.stderr.includes(failedSource.id));
    assert.equal(turns(), 8);
    writeFileSync(
      driver,
      readFileSync(driver, 'utf8').replace("if(input.message==='fail') process.exit(1);", ''),
    );
    const recovered = activate(failedSource.id);
    assert.ok(Array.isArray(recovered) && recovered.length === 1);
    assert.deepEqual(activate(failedSource.id), recovered);
    assert.equal(turns(), 9);
    assert.deepEqual(
      json(['--direct', 'room', 'messages', room.id]),
      json(['room', 'messages', room.id]),
    );
    assert.equal(run(['room', 'archive', room.id]).status, 0);
    assert.equal(run(['room', 'activate', room.id, '--message', source.id]).status, 1);
    const archived = json(['room', 'messages', room.id]);
    assert.equal(
      run(['agent', 'send', cto, 'No', '--room', room.id, '--human', 'founder']).status,
      1,
    );
    assert.deepEqual(json(['room', 'messages', room.id]), archived);
    assert.equal(turns(), 9);
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
