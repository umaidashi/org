import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runDockerSandbox } from '../src/sandbox/docker.js';
import { runProcess } from '../src/runtime/process.js';
// Opt-in: normal UT does not require a running Docker engine.
test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'real Docker enforces readonly, writable, timeout and cancellation',
  async () => {
    const host = {
      executable: 'docker',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      cwd: process.cwd(),
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
    };
    const input = {
      code: 'console.log(7)',
      files: [],
      writable: false,
      timeoutMs: 3000,
      maxOutputBytes: 4096,
    };
    const read = await runDockerSandbox(runProcess, host, {
      ...input,
      code: `import {writeFileSync} from 'node:fs';try {writeFileSync('/workspace/result','x');throw new Error('writable');}catch(e){if(e.code!=='EACCES')throw e;}console.log(7);`,
    });
    assert.equal(read.exitCode, 0);
    assert.equal(read.stdout, '7\n');
    const write = await runDockerSandbox(runProcess, host, {
      ...input,
      writable: true,
      code: `import {writeFileSync,readFileSync} from 'node:fs';writeFileSync('/workspace/result','ok');console.log(readFileSync('/workspace/result','utf8'));`,
    });
    assert.equal(write.exitCode, 0);
    assert.equal(write.stdout, 'ok\n');
    const artifact = await runDockerSandbox(runProcess, host, {
      ...input,
      writable: true,
      files: ['result.txt'],
      code: "await Bun.write('result.txt','artifact');",
    });
    assert.deepEqual(artifact.files, [
      { path: 'result.txt', base64: Buffer.from('artifact').toString('base64') },
    ]);
    await assert.rejects(
      runDockerSandbox(runProcess, host, {
        ...input,
        writable: true,
        files: ['result.txt'],
        code: "import {symlinkSync} from 'node:fs';symlinkSync('/etc/passwd','result.txt');",
      }),
      /artifact/,
    );
    const limited = await runDockerSandbox(runProcess, host, {
      ...input,
      maxOutputBytes: 8,
      code: "console.log('x'.repeat(10000));",
    });
    assert.equal(limited.reason, 'output_limit');
    assert.ok(Buffer.byteLength(limited.stdout) + Buffer.byteLength(limited.stderr) <= 8);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const cancelled = await runDockerSandbox(
        runProcess,
        host,
        { ...input, code: 'await new Promise(()=>{});' },
        controller.signal,
      );
      assert.equal(cancelled.reason, 'cancelled');
    } finally {
      clearTimeout(timer);
    }
    const timeout = await runDockerSandbox(runProcess, host, {
      ...input,
      timeoutMs: 200,
      code: 'await new Promise(()=>{});',
    });
    assert.equal(timeout.reason, 'timeout');
    await assert.rejects(
      runDockerSandbox(runProcess, host, input, AbortSignal.abort()),
      /cancelled/,
    );
  },
  15000,
);

test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'real Docker parent crash leaves a bounded container lifetime',
  async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const paths = await import('node:path');
    const directory = await mkdtemp(paths.join(tmpdir(), 'org-sandbox-crash-'));
    let id: string | undefined;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const path = paths.join(directory, 'parent.ts');
      await writeFile(
        path,
        `import {runDockerSandbox} from ${JSON.stringify(new URL('../src/sandbox/docker.ts', import.meta.url).pathname)};import {runProcess} from ${JSON.stringify(new URL('../src/runtime/process.ts', import.meta.url).pathname)};let id;await runDockerSandbox(async input=>{if(input.argv.includes('/workspace/.org-execution.ts'))console.log('ready:'+id);const result=await runProcess(input);if(input.argv[1]==='create')id=result.stdout.trim();return result;},{executable:'docker',env:{PATH:process.env.PATH,HOME:process.env.HOME},cwd:process.cwd(),uid:process.getuid(),gid:process.getgid()},{code:'await new Promise(()=>{});',files:[],writable:false,timeoutMs:1000,maxOutputBytes:4096});`,
        { mode: 0o600 },
      );
      child = Bun.spawn([process.execPath, '--no-env-file', path], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      assert.ok(typeof child.stdout !== 'number' && child.stdout !== undefined);
      const reader = child.stdout.getReader();
      const ready = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Sandbox parent not ready')), 5000),
        ),
      ]);
      reader.releaseLock();
      const match = /ready:([a-f0-9]{64})/.exec(new TextDecoder().decode(ready.value));
      assert.ok(match?.[1]);
      id = match[1];
      child.kill('SIGKILL');
      await child.exited;
      const deadline = Date.now() + 40000;
      for (;;) {
        const inspect = Bun.spawn(['docker', 'inspect', id], {
          stdout: 'ignore',
          stderr: 'ignore',
        });
        if ((await inspect.exited) !== 0) break;
        if (Date.now() > deadline) throw new Error('Sandbox container survived deadline');
        await Bun.sleep(500);
      }
    } finally {
      child?.kill('SIGKILL');
      if (child) await child.exited;
      if (id) {
        const cleanup = Bun.spawn(['docker', 'rm', '--force', id], {
          stdout: 'ignore',
          stderr: 'ignore',
        });
        await cleanup.exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  45000,
);

test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'real Docker injects only explicit credentials without metadata or artifact disclosure',
  async () => {
    const secret = 'synthetic-docker-private-token-702';
    const host = {
      executable: 'docker',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      cwd: process.cwd(),
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
      credentials: { SERVICE_TOKEN: secret },
    };
    const input = {
      code: '',
      files: [] as string[],
      writable: false,
      timeoutMs: 3000,
      maxOutputBytes: 4096,
    };
    let id: string | undefined;
    const checkedRun = async (request: Parameters<typeof runProcess>[0]) => {
      assert.ok(!JSON.stringify(request.argv).includes(secret));
      assert.ok(!JSON.stringify(request.env).includes(secret));
      const result = await runProcess(request);
      if (request.argv[1] === 'create') {
        id = result.stdout.trim();
        const inspected = await runProcess({
          ...request,
          argv: ['docker', 'inspect', id],
          input: '',
          maxOutputBytes: 65536,
        });
        assert.equal(inspected.exitCode, 0);
        assert.ok(!inspected.stdout.includes(secret));
      }
      return result;
    };
    const safe = await runDockerSandbox(checkedRun, host, {
      ...input,
      code: `if(process.env.SERVICE_TOKEN!==${JSON.stringify(secret)}||process.env.HOME!==undefined||process.env.TYPESAFE_API_KEY!==undefined)throw new Error('environment mismatch');console.log('credential-present');`,
    });
    assert.equal(safe.stdout, 'credential-present\n');
    for (const code of [
      'console.log(process.env.SERVICE_TOKEN)',
      'console.error(process.env.SERVICE_TOKEN)',
      "await Bun.write('result.txt',process.env.SERVICE_TOKEN??'')",
    ]) {
      await assert.rejects(
        runDockerSandbox(checkedRun, host, {
          ...input,
          code,
          writable: true,
          files: code.includes('Bun.write') ? ['result.txt'] : [],
        }),
        /credential output rejected/,
      );
      assert.ok(id);
      const inspected = await runProcess({
        argv: ['docker', 'inspect', id],
        input: '',
        env: host.env,
        cwd: host.cwd,
        timeoutMs: 3000,
        maxOutputBytes: 4096,
      });
      assert.notEqual(inspected.exitCode, 0);
    }
  },
  15000,
);
