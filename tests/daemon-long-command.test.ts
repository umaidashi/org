import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runLocalDaemon } from '../src/daemon/server.js';
import { requestApplication, requestDaemon } from '../src/daemon/client.js';
test('daemon command preserves long Runtime replies even with options before the noun', async () => {
  const dir = mkdtempSync('/tmp/org-long-command-');
  const socket = join(dir, 'org.sock');
  const daemon = runLocalDaemon(socket, 60000, () => ({
    dispatch: () => [],
    deliveries: () => [],
    close: () => undefined,
    command: async () => {
      await Bun.sleep(11000);
      return { code: 0, stdout: ['long reply'], stderr: [] };
    },
  }));
  const began = Date.now();
  try {
    const results = await Promise.allSettled([
      requestApplication(socket, ['--json', 'room', 'activate', 'r', '--message', 'm']),
      requestApplication(socket, ['session', 'get', 's']),
      requestApplication(socket, ['knowledge', 'notion', '3ee8a4020cb681d18daacc1e0016d596']),
      requestApplication(socket, ['--json', 'session', 'get', 's']),
      requestApplication(socket, [
        '--json',
        'task',
        'run',
        't',
        '--session',
        's',
        '--room-message',
        'm',
      ]),
    ]);
    for (const result of results) {
      assert.equal(result.status, 'fulfilled');
      if (result.status === 'fulfilled') assert.deepEqual(result.value.stdout, ['long reply']);
    }
    assert.ok(Date.now() - began >= 10000);
  } finally {
    await requestDaemon(socket, 'stop');
    await daemon;
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
