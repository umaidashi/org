import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { runProcess } from '../src/runtime/process.js';

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
for (const mode of ['timeout', 'cancelled', 'exited'] as const) {
  test(`runtime ${mode} terminates a descendant that inherits its output pipes`, async () => {
    const home = mkdtempSync('/tmp/org-runtime-group-');
    const marker = home + '/pid';
    const controller = new AbortController();
    let descendant: number | undefined;
    const childCode = 'setInterval(()=>{},100)';
    const code = `const child=Bun.spawn([process.execPath,'--no-env-file','-e',${JSON.stringify(childCode)}],{stdout:'inherit',stderr:'inherit'}); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); ${mode === 'exited' ? 'process.exit(0);' : 'setInterval(()=>{},100);'}`;
    const pending = runProcess({
      argv: [process.execPath, '--no-env-file', '-e', code],
      input: '',
      env: {},
      cwd: home,
      timeoutMs: mode === 'timeout' ? 500 : 2000,
      maxOutputBytes: 1024,
      signal: controller.signal,
    });
    try {
      for (let attempts = 0; !existsSync(marker) && attempts < 100; attempts++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(existsSync(marker), 'driver started descendant');
      descendant = Number(readFileSync(marker, 'utf8'));
      assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
      if (mode === 'cancelled') controller.abort();
      for (let attempts = 0; alive(descendant) && attempts < 100; attempts++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(alive(descendant), false, 'descendant must terminate');
      assert.equal((await pending).reason, mode);
    } finally {
      controller.abort();
      if (descendant !== undefined && alive(descendant)) process.kill(descendant, 'SIGKILL');
      await pending;
      rmSync(home, { recursive: true, force: true });
    }
  });
}
