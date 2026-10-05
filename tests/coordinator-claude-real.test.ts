import { checkGeneratedCode } from './generated-code-check.js';
import { verifyCodeGitHandoff } from './code-git-handoff.js';
import { runDockerSandbox } from '../src/sandbox/docker.js';
import { runProcess } from '../src/runtime/process.js';
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
  const deadline = clock.now() + 180000;
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
function assertGeneratedTests(result: { exitCode: number | null; stderr: string }): void {
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /\b[1-9][0-9]* pass\b/);
  assert.match(result.stderr, /\b0 fail\b/);
  assert.match(result.stderr, /Ran [1-9][0-9]* tests?\b/);
}
test('code proof refuses a successful process with zero executed generated tests', () => {
  assert.throws(() => assertGeneratedTests({ exitCode: 0, stderr: '0 pass\n0 fail\nRan 0 tests' }));
});
test('code proof polling permits combined Runtime and Docker limits', async () => {
  let time = 0;
  assert.equal(
    await waitForProjection(() => (time >= 150000 ? 'ready' : undefined), {
      now: () => time,
      sleep: async () => {
        time += 100;
      },
    }),
    'ready',
  );
});
async function proof(code = false) {
  const codeObjective =
    'Implement answer.ts exporting sumIntegers(a:number,b:number):number. Accept only safe integers and throw on noninteger or unsafe sum. Write answer.test.ts with Bun tests of valid and invalid inputs. Import from ./answer.js (Bun resolves answer.ts). Follow strict TypeScript with no any, no non-null assertions, no floating promises. Run bun --no-env-file test answer.test.ts inside Sandbox and throw if tests fail. Use no external services. Return only the host Sandbox JSON proposal with TypeScript code that writes these files and executes tests.';
  const home = mkdtempSync('/tmp/org-a2a-proposal-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--no-env-file',
        ...(code ? ['--preload', home + '/linear-fixture.ts'] : []),
        cli,
        '--db',
        db,
        ...(args.includes('--direct') ? [] : ['--socket', socket]),
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: 130000,
        env: code ? { ...process.env, LINEAR_API_KEY: 'fixture-code-issue-key' } : process.env,
      },
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
      ...(code ? ['--preload', home + '/linear-fixture.ts'] : []),
      cli,
      '--db',
      db,
      'daemon',
      '--socket',
      socket,
      '--runtime-config',
      home + '/runtime.json',
      '--wake-up',
      ...(code ? ['--sandbox-config', home + '/sandbox.json'] : []),
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
    if (code)
      writeFileSync(
        home + '/linear-fixture.ts',
        `import assert from 'node:assert/strict';const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{if(String(input)==='https://api.linear.app/graphql'){assert.equal(init.method,'POST');assert.equal(new Headers(init.headers).get('Authorization'),'fixture-code-issue-key');assert.deepEqual(JSON.parse(init.body).variables,{id:'ORG-1'});return Response.json(${JSON.stringify({ data: { issue: { id: '11111111-1111-4111-8111-111111111111', identifier: 'ORG-1', title: 'Integer addition fixture', description: codeObjective, url: 'https://linear.app/example/issue/ORG-1/integer-addition' } } })});}return original(input,init);};`,
      );
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
        ...(code
          ? [
              '--capability',
              'can_run_shell',
              '--capability',
              'can_write',
              '--capability',
              'can_read',
            ]
          : []),
      ]).status,
      0,
    );
    const agents = list(['--direct', 'agent', 'list']);
    const chief = agents.find((a) => a.name === 'Chief'),
      worker = agents.find((a) => a.name === 'Specialist');
    assert.ok(chief && worker && typeof chief.id === 'string' && typeof worker.id === 'string');
    json(['--direct', 'agent', 'report', worker.id, '--to', chief.id]);
    const work = code ? entity(['--direct', 'task', 'import-linear', 'ORG-1']) : undefined;
    const room = entity([
      '--direct',
      'room',
      'create',
      'Company',
      '--type',
      code ? 'task' : 'group',
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
      payload: {
        objective: code
          ? String(work?.objective)
          : 'Use only supplied information. Calculate 6 * 7 and reply exactly RESULT_42. Do not use tools or external services.',
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
    if (code)
      writeFileSync(
        home + '/sandbox.json',
        JSON.stringify({
          writable: true,
          files: ['answer.ts', 'answer.test.ts'],
          timeoutMs: 30000,
          maxOutputBytes: 65536,
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
    const task = await wait(() => {
      const candidate = list(['task', 'list']).find(
        (t) => t.externalRef === `org://rooms/${room.id}/messages/${adoptedId}`,
      );
      if (candidate?.status === 'failed') throw new Error('Specialist execution failed');
      return candidate?.status === 'waiting_approval' ? candidate : undefined;
    });
    assert.ok(typeof task.id === 'string' && typeof task.version === 'number');
    assert.equal(task.owner, worker.id);
    assert.equal(task.parentId, work?.id ?? null);
    const taskRoom = list(['room', 'list']).find((r) => r.taskId === task.id);
    assert.ok(taskRoom && typeof taskRoom.id === 'string');
    const artifacts = list(['task', 'artifacts', task.id]);
    assert.equal(artifacts.length, 1);
    const artifact = artifacts[0];
    assert.ok(artifact && typeof artifact.id === 'string');
    let checkedFiles: readonly { readonly path: string; readonly base64: string }[] | undefined;
    let checkedContent: string | undefined;
    if (code) {
      const stored = entity(['task', 'artifact-content', task.id, '--artifact', artifact.id]);
      assert.ok(typeof stored.content === 'string');
      const contents: unknown = JSON.parse(stored.content);
      assert.ok(
        record(contents) &&
          typeof contents.proposalRef === 'string' &&
          Array.isArray(contents.files),
      );
      const taskRoomId = taskRoom.id;
      const proposalMessage = list(['room', 'messages', taskRoomId]).find(
        (m) =>
          typeof m.id === 'string' &&
          contents.proposalRef === `org://rooms/${taskRoomId}/messages/${m.id}`,
      );
      assert.ok(
        proposalMessage &&
          record(proposalMessage.sender) &&
          proposalMessage.sender.id === worker.id,
      );
      const files = Array.from(contents.files, (file: unknown) => {
        assert.ok(record(file) && typeof file.path === 'string' && typeof file.base64 === 'string');
        return { path: file.path, base64: file.base64 };
      });
      assert.deepEqual(
        files.map((f) => f.path),
        ['answer.ts', 'answer.test.ts'],
      );
      const implementation = files[0],
        generatedTests = files[1];
      assert.ok(implementation && generatedTests);
      const verified = await runDockerSandbox(
        runProcess,
        {
          executable: 'docker',
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
          cwd: home,
          uid: process.getuid?.() ?? 0,
          gid: process.getgid?.() ?? 0,
        },
        {
          writable: true,
          files: [],
          timeoutMs: 30000,
          maxOutputBytes: 65536,
          code: `import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';writeFileSync('/workspace/answer.ts',Buffer.from(${JSON.stringify(implementation.base64)},'base64'));writeFileSync('/workspace/answer.test.ts',Buffer.from(${JSON.stringify(generatedTests.base64)},'base64'));const tests=Bun.spawnSync(['bun','--no-env-file','test','answer.test.ts']);process.stderr.write(tests.stderr);assert.equal(tests.exitCode,0);const {sumIntegers}=await import('/workspace/answer.ts');assert.equal(sumIntegers(2,3),5);assert.equal(sumIntegers(-4,1),-3);assert.equal(sumIntegers(0,0),0);assert.equal(sumIntegers(40,2),42);assert.throws(()=>sumIntegers(1.5,2));assert.throws(()=>sumIntegers(Number.MAX_SAFE_INTEGER,1));console.log('INDEPENDENT_CODE_CHECK_OK');`,
        },
      );
      assert.equal(verified.reason, 'exited');
      assertGeneratedTests(verified);
      await checkGeneratedCode(files);
      assert.equal(verified.exitCode, 0, verified.stderr);
      assert.equal(verified.stdout, 'INDEPENDENT_CODE_CHECK_OK\n');
      checkedFiles = files;
      checkedContent = stored.content;
    } else {
      const output = list(['room', 'messages', taskRoom.id]).find((m) => m.id === artifact.id);
      assert.ok(output && typeof output.content === 'string');
      assertSpecialistResult(output.content);
      assert.ok(record(output.sender));
      assert.equal(output.sender.id, worker.id);
    }
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
    const reviewed = json([
      'task',
      'review',
      task.id,
      '--decision',
      'approve',
      '--actor',
      'founder',
      '--reason',
      code
        ? 'Verified generated code with independent real Docker assertions'
        : 'Verified native specialist Artifact RESULT_42',
      '--expected-version',
      String(task.version),
    ]);
    if (code) {
      assert.ok(record(reviewed) && reviewed.status === 'completed');
      assert.ok(
        Array.isArray(reviewed.outputArtifacts) && reviewed.outputArtifacts.includes(artifact.id),
      );
      assert.ok(checkedFiles && checkedContent !== undefined);
      assert.equal(
        entity(['task', 'artifact-content', task.id, '--artifact', artifact.id]).content,
        checkedContent,
      );
      await verifyCodeGitHandoff(checkedFiles, home + '/code-git');
    }
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
    if (work) {
      assert.deepEqual(entity(['task', 'get', work.id]), work);
      assert.equal(list(['task', 'history', work.id]).length, 1);
      assert.deepEqual(entity(['--direct', 'task', 'import-linear', 'ORG-1']), work);
    }
    assert.deepEqual(list(['memory', 'list', '--scope', 'task:' + task.id]), [memory]);
    assert.equal(list(['a2a', 'list', room.id]).filter((m) => m.type === 'decision').length, 1);
    assert.equal(list(['a2a', 'list', room.id]).filter((m) => m.id === adopted.id).length, 1);
    assert.equal(
      list(['room', 'messages', room.id]).find((m) => m.id === original.id)?.content,
      original.content,
    );
  } catch (error) {
    if (code && daemon) {
      const rooms = list(['room', 'list']);
      const debug = rooms
        .filter((r) => r.type === 'task' && typeof r.id === 'string')
        .map((r) => ({ roomId: r.id, messages: list(['room', 'messages', String(r.id)]) }));
      writeFileSync(
        '/tmp/org-code-loop-private-debug-' + process.pid + '.json',
        JSON.stringify(debug),
        { mode: 0o600 },
      );
    }
    throw error;
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
  () => proof(),
  360000,
);

test.skipIf(process.env.ORG_CLAUDE_CODE_TEST !== '1')(
  'real Claude delegation generates code and tests in Docker before human review Memory and restart',
  () => proof(true),
  900000,
);

test.skipIf(process.env.ORG_GENERATED_GATE_TEST !== '1')(
  'generated code gate rejects runtime-valid explicit-any source',
  async () => {
    const code =
      "export function sumIntegers(a:number,b:number):number {const result:any=a+b;if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||!Number.isSafeInteger(result))throw new Error('invalid');return result;}";
    const tests =
      "import {test,expect} from 'bun:test';import {sumIntegers} from './answer.js';test('addition',()=>{expect(sumIntegers(2,3)).toBe(5);});";
    await assert.rejects(
      () =>
        checkGeneratedCode([
          { path: 'answer.ts', base64: Buffer.from(code).toString('base64') },
          { path: 'answer.test.ts', base64: Buffer.from(tests).toString('base64') },
        ]),
      /no-explicit-any/,
    );
  },
  240000,
);
