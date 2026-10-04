import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}
for (const mode of ['source', 'bundled'] as const) {
  test(`killing the ${mode} runtime owner also terminates its driver and descendant`, async () => {
    const home = mkdtempSync('/tmp/org-guardian-');
    const marker = home + '/pids';
    const program = home + '/owner.ts';
    let processModule = fileURLToPath(new URL('../src/runtime/process.ts', import.meta.url));
    if (mode === 'bundled') {
      const result = await Bun.build({
        entrypoints: [processModule],
        target: 'bun',
        outdir: home,
        naming: 'runtime.js',
      });
      assert.equal(result.success, true, 'Runtime bundle builds');
      processModule = home + '/runtime.js';
    }
    const driver = `const child=Bun.spawn([process.execPath,'--no-env-file','-e','setInterval(()=>{},100)'],{stdout:'inherit',stderr:'inherit'});await Bun.write(${JSON.stringify(marker)}, JSON.stringify([process.pid,child.pid]));setInterval(()=>{},100);`;
    writeFileSync(
      program,
      `import {runProcess} from ${JSON.stringify(processModule)}; await runProcess(${JSON.stringify({ argv: [process.execPath, '--no-env-file', '-e', driver], input: 'input', env: {}, cwd: home, timeoutMs: 10000, maxOutputBytes: 1024 })});`,
    );
    const owner = spawn(process.execPath, ['--no-env-file', program], { stdio: 'ignore' });
    const exited = new Promise((resolve) => owner.once('exit', resolve));
    const pids: number[] = [];
    try {
      for (let attempts = 0; !existsSync(marker) && attempts < 100; attempts++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(existsSync(marker), 'driver and descendant started');
      const values: unknown = JSON.parse(readFileSync(marker, 'utf8'));
      assert.ok(Array.isArray(values));
      for (const value of values) {
        assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
        pids.push(value);
      }
      assert.equal(pids.length, 2);
      owner.kill('SIGKILL');
      await exited;
      for (let attempts = 0; pids.some(alive) && attempts < 100; attempts++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(pids.map(alive), [false, false]);
    } finally {
      owner.kill('SIGKILL');
      await exited;
      for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
      rmSync(home, { recursive: true, force: true });
    }
  });
}
