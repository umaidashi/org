import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'Coordinator runtime proposal auto=%s WorkItem=%s adopts once into specialist execution and human decision across daemon restart',
  async (automatic, linked) => {
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
        { encoding: 'utf8', timeout: 10000 },
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
        ...(automatic && delegationRoom !== undefined ? ['--delegation-room', delegationRoom] : []),
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
    const wait = async <T>(read: () => T | undefined): Promise<T> => {
      for (let i = 0; i < 100; i++) {
        const value = read();
        if (value !== undefined) return value;
        await Bun.sleep(25);
      }
      throw Error('expected daemon projection');
    };
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
          'codex',
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
          'codex',
        ]).status,
        0,
      );
      const agents = list(['--direct', 'agent', 'list']);
      const chief = agents.find((a) => a.name === 'Chief'),
        worker = agents.find((a) => a.name === 'Specialist');
      assert.ok(chief && worker && typeof chief.id === 'string' && typeof worker.id === 'string');
      json(['--direct', 'agent', 'report', worker.id, '--to', chief.id]);
      const work = linked
        ? entity([
            '--direct',
            'task',
            'create',
            'Source work',
            '--objective',
            'Preserve external work',
          ])
        : undefined;
      const room = entity([
        '--direct',
        'room',
        'create',
        'Company',
        '--type',
        linked ? 'task' : 'group',
        ...(work ? ['--task', work.id] : []),
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
        payload: { objective: 'Research options' },
      });
      writeFileSync(
        home + '/runtime.ts',
        `#!${process.execPath}\nconst input=JSON.parse(await Bun.stdin.text());if(${automatic} && input.message==='please delegate' && !JSON.parse(JSON.parse(input.instruction).instruction).delegation.targets.some(t=>t.id===${JSON.stringify(worker.id)})) throw Error('host target context missing');const text=input.message==='please delegate'?${JSON.stringify(proposal)}:'Research complete';console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
        { mode: 0o700 },
      );
      writeFileSync(
        home + '/runtime.json',
        JSON.stringify({
          codex: {
            executable: home + '/runtime.ts',
            cwd: home,
            env: [],
            timeoutMs: 5000,
            maxOutputBytes: 4096,
          },
        }),
      );
      await launch();
      const source = entity([
        'room',
        'send',
        room.id,
        '--human',
        'founder',
        '--content',
        'please delegate',
      ]);
      const original = await wait(() =>
        list(['room', 'messages', room.id]).find(
          (m) => m.replyTo === source.id && record(m.sender) && m.sender.id === chief.id,
        ),
      );
      assert.ok(typeof original.id === 'string');
      assert.equal(original.content, proposal);
      if (!automatic) assert.equal(list(['a2a', 'list', room.id]).length, 0);
      const adopted = automatic
        ? await wait(() => list(['a2a', 'list', room.id]).find((m) => m.type === 'delegate'))
        : entity(['a2a', 'adopt', room.id, '--message', original.id]);
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
      assert.equal(task.parentId, work?.id ?? null);
      json([
        'task',
        'review',
        task.id,
        '--decision',
        'approve',
        '--actor',
        'founder',
        '--reason',
        'Checked fixture output',
        '--expected-version',
        String(task.version),
      ]);
      await wait(() =>
        list(['a2a', 'list', room.id]).find(
          (m) => m.type === 'decision' && m.replyTo === adopted.id,
        ),
      );
      json(['daemon', 'stop']);
      await exited;
      daemon = undefined;
      await launch();
      assert.deepEqual(entity(['a2a', 'adopt', room.id, '--message', original.id]), adopted);
      assert.equal(list(['task', 'list']).filter((t) => t.id === task.id).length, 1);
      assert.equal(list(['a2a', 'list', room.id]).filter((m) => m.id === adopted.id).length, 1);
      assert.equal(
        list(['room', 'messages', room.id]).find((m) => m.id === original.id)?.content,
        proposal,
      );
      if (work) assert.deepEqual(entity(['task', 'get', work.id]), work);
    } finally {
      if (daemon) {
        run(['daemon', 'stop']);
        daemon.kill('SIGTERM');
        await exited;
      }
      rmSync(home, { recursive: true, force: true });
    }
  },
);
