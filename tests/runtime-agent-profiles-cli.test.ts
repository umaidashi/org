import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { cli } from './cli-path.js';

test('native daemon selects Agent cwd and aliased env across resume, preserves default and refuses missing profile runtime', async () => {
  const home = realpathSync(mkdtempSync('/tmp/org-runtime-profiles-')),
    db = home + '/org.db',
    socket = home + '/org.sock',
    executable = home + '/driver.ts',
    config = home + '/runtime.json',
    calls = home + '/calls';
  for (const name of ['alpha', 'beta']) mkdirSync(home + '/' + name);
  writeFileSync(calls, '');
  writeFileSync(
    executable,
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';
    import {basename} from 'node:path'; await Bun.stdin.text();
    appendFileSync(${JSON.stringify(calls)}, 'turn\\n');
    const text=JSON.stringify({cwd:process.cwd(),home:process.env.HOME??null,marker:process.env.ORG_MARKER??null,
      foreign:!!(process.env.ORG_ALPHA_SECRET||process.env.ORG_BETA_SECRET||process.env.ORG_HOST_ONLY)});
    const id='provider-'+basename(process.cwd());
    if(process.argv.includes('--print')) console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:id,result:text}));
    else {console.log(JSON.stringify({type:'thread.started',thread_id:id}));
      console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));
      console.log(JSON.stringify({type:'turn.completed',usage:{}}));}`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    ORG_MARKER: 'fixture-default',
    ORG_ALPHA_SECRET: 'fixture-alpha',
    ORG_BETA_SECRET: 'fixture-beta',
    ORG_ALPHA_HOME: home + '/alpha',
    ORG_BETA_HOME: home + '/beta',
    ORG_HOST_ONLY: 'fixture-excluded',
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env,
    });
  const json = (args: string[]): Record<string, unknown> => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  const id = (value: Record<string, unknown>): string => {
    assert.equal(typeof value.id, 'string');
    return String(value.id);
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  try {
    const agents = [];
    for (const [name, runtime] of [
      ['alpha', 'codex'],
      ['beta', 'codex'],
      ['default', 'claude'],
      ['denied', 'claude'],
    ]) {
      assert.ok(name && runtime);
      assert.equal(
        run(['--direct', 'agent', 'create', name, '--role', name, '--runtime', runtime]).status,
        0,
      );
      const listed = run(['--direct', 'agent', 'list', '--json']);
      assert.equal(listed.status, 0, listed.stderr);
      const values: unknown = JSON.parse(listed.stdout);
      assert.ok(Array.isArray(values));
      const agent: unknown = values.find(
        (v: unknown) => v && typeof v === 'object' && 'name' in v && v.name === name,
      );
      assert.ok(
        agent && typeof agent === 'object' && 'id' in agent && typeof agent.id === 'string',
      );
      const room = json([
        '--direct',
        'room',
        'create',
        name,
        '--type',
        'direct',
        '--human',
        'founder',
        '--agent',
        agent.id,
      ]);
      agents.push({ id: agent.id, room: id(room), name });
    }
    const [alpha, beta, fallback, denied] = agents;
    assert.ok(alpha && beta && fallback && denied);
    const driver = {
      executable,
      cwd: home,
      env: ['ORG_MARKER'],
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    };
    writeFileSync(
      config,
      JSON.stringify({
        codex: driver,
        claude: driver,
        agents: {
          [alpha.id]: {
            codex: {
              ...driver,
              cwd: home + '/alpha',
              env: { HOME: 'ORG_ALPHA_HOME', ORG_MARKER: 'ORG_ALPHA_SECRET' },
            },
          },
          [beta.id]: {
            codex: {
              ...driver,
              cwd: home + '/beta',
              env: { HOME: 'ORG_BETA_HOME', ORG_MARKER: 'ORG_BETA_SECRET' },
            },
          },
          [denied.id]: { codex: driver },
        },
      }),
    );
    daemon = spawn(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', '--socket', socket, '--runtime-config', config],
      { env },
    );
    const child = daemon;
    exited = new Promise((resolve) => child.once('exit', resolve));
    let error = '';
    child.stderr?.on('data', (b: Buffer) => {
      error += b.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(error || 'daemon not ready')), 5000);
      child.stdout?.on('data', (b: Buffer) => {
        if (b.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    for (const agent of [alpha, beta, fallback]) {
      const started = json([
        '--socket',
        socket,
        'session',
        'start',
        '--agent',
        agent.id,
        '--room',
        agent.room,
        '--message',
        'first',
      ]);
      assert.equal(typeof started.text, 'string');
      const result: unknown = JSON.parse(String(started.text));
      assert.deepEqual(result, {
        cwd: agent === fallback ? home : home + '/' + agent.name,
        home: agent === fallback ? null : home + '/' + agent.name,
        marker: agent === fallback ? 'fixture-default' : 'fixture-' + agent.name,
        foreign: false,
      });
      if (agent !== fallback) {
        assert.ok(
          started.session &&
            typeof started.session === 'object' &&
            'id' in started.session &&
            typeof started.session.id === 'string',
        );
        const resumed = json([
          '--socket',
          socket,
          'session',
          'resume',
          started.session.id,
          '--message',
          'again',
        ]);
        assert.equal(resumed.text, started.text);
        assert.ok(
          resumed.session &&
            typeof resumed.session === 'object' &&
            'id' in resumed.session &&
            'providerSessionId' in resumed.session,
        );
        assert.equal(resumed.session.id, started.session.id);
        assert.ok('providerSessionId' in started.session);
        assert.equal(resumed.session.providerSessionId, started.session.providerSessionId);
      }
    }
    const before = readFileSync(calls, 'utf8');
    assert.equal(before.trim().split('\n').length, 5);
    const refused = run([
      '--socket',
      socket,
      'session',
      'start',
      '--agent',
      denied.id,
      '--room',
      denied.room,
      '--message',
      'no fallback',
    ]);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /Runtime claude is not configured/);
    assert.equal(readFileSync(calls, 'utf8'), before);
  } finally {
    if (daemon) {
      run(['--socket', socket, 'daemon', 'stop']);
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
