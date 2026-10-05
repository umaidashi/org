import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'bun:test';
import { runLocalDaemon } from '../src/daemon/server.js';
test('SIGINT releases the daemon while preserving replacement socket and lock entries', async () => {
  const home = mkdtempSync('/tmp/org-server-replaced-');
  const socket = join(home, 'org.sock');
  const child = spawn(
    process.execPath,
    ['--no-env-file', cli, '--db', join(home, 'org.db'), 'daemon', '--socket', socket],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await ready(child);
    unlinkSync(socket);
    writeFileSync(socket, 'replacement socket');
    rmdirSync(`${socket}.lock`);
    writeFileSync(`${socket}.lock`, 'replacement lock');
    child.kill('SIGINT');
    assert.equal(await exit(child), 0);
    assert.equal(readFileSync(socket, 'utf8'), 'replacement socket');
    assert.equal(readFileSync(`${socket}.lock`, 'utf8'), 'replacement lock');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await exit(child);
    }
    rmSync(home, { recursive: true, force: true });
  }
});
function ready(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => reject(new Error('Daemon did not become ready')), 5000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('"ready"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Daemon exited before ready: ${code}: ${stderr}`));
    });
  });
}
function exit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Daemon did not exit'));
    }, 5000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
test('continuous daemon polls new Events, serves local clients and releases socket across restart', async () => {
  const home = mkdtempSync('/tmp/org-server-');
  const db = join(home, 'org.db');
  const socket = join(home, 'org.sock');
  const prefix = ['--no-env-file', cli, '--db', db];
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [...prefix, ...(args[0] === 'daemon' ? args : ['--direct', ...args])],
      { encoding: 'utf8', timeout: 10_000 },
    );
  const client = (action: string) => run(['daemon', action, '--socket', socket, '--json']);
  let child: ChildProcess | undefined;
  try {
    assert.equal(
      run(['agent', 'create', 'dev', '--role', 'Developer', '--runtime', 'codex']).status,
      0,
    );
    const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const agent = agents[0]?.id;
    assert.ok(agent);
    assert.equal(
      run(['event', 'subscribe', '**', '--subscriber-type', 'agent', '--subscriber', agent]).status,
      0,
    );
    child = spawn(
      process.execPath,
      [...prefix, 'daemon', '--socket', socket, '--poll-interval', '25'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await ready(child);
    assert.equal(statSync(socket).mode & 0o777, 0o600);
    assert.equal(client('status').status, 0);
    const forbidden = await fetch('http://org.local/v1/stop', {
      unix: socket,
      method: 'POST',
      headers: { origin: 'http://example.invalid' },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(client('status').status, 0);
    assert.equal((await fetch('http://org.local/v1/unknown', { unix: socket })).status, 404);
    const duplicate = run(['daemon', '--socket', socket]);
    assert.equal(duplicate.status, 1, duplicate.stderr);
    assert.equal(client('status').status, 0);
    assert.equal(run(['event', 'publish', 'manual.requested', '--source', 'manual']).status, 0);
    let count = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const tasks = run(['task', 'list', '--json']);
      assert.equal(tasks.status, 0, tasks.stderr);
      count = (JSON.parse(tasks.stdout) as unknown[]).length;
      if (count === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(count, 1);
    assert.equal(client('dispatch').status, 0);
    assert.equal(client('deliveries').status, 0);
    assert.equal(client('stop').status, 0);
    assert.equal(await exit(child), 0);
    child = undefined;
    assert.equal(existsSync(socket), false);
    assert.equal(existsSync(`${socket}.lock`), false);
    child = spawn(
      process.execPath,
      [...prefix, 'daemon', '--socket', socket, '--poll-interval', '25'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await ready(child);
    assert.equal((JSON.parse(run(['task', 'list', '--json']).stdout) as unknown[]).length, 1);
    child.kill('SIGTERM');
    assert.equal(await exit(child), 0);
    child = undefined;
    assert.equal(existsSync(socket), false);
    assert.equal(existsSync(`${socket}.lock`), false);
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await exit(child);
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
test('daemon refuses to replace an existing file and client failure creates no database', () => {
  const home = mkdtempSync('/tmp/org-server-invalid-');
  const socket = join(home, 'existing');
  const db = join(home, 'db', 'org.db');
  try {
    writeFileSync(socket, 'keep');
    const result = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', '--socket', socket],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(socket, 'utf8'), 'keep');
    unlinkSync(socket);
    symlinkSync(join(home, 'missing-target'), socket);
    const symlink = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', '--socket', socket],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(symlink.status, 1, symlink.stderr);
    assert.match(symlink.stderr, /already exists/);
    assert.equal(lstatSync(socket).isSymbolicLink(), true);
    const client = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', 'status', '--socket', join(home, 'missing')],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(client.status, 1);
    assert.equal(existsSync(db), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('adapter close failure still releases owned socket, lock and process umask', async () => {
  const home = mkdtempSync('/tmp/org-server-cleanup-');
  const socket = join(home, 'org.sock');
  const originalMask = process.umask();
  try {
    const done = runLocalDaemon(socket, 1000, () => ({
      dispatch: () => [],
      deliveries: () => [],
      close: () => {
        throw new Error('close failure');
      },
    })).then(
      () => null,
      (error: unknown) => error,
    );
    assert.equal(existsSync(socket), true);
    const response = await fetch('http://org.local/v1/stop', {
      unix: socket,
      method: 'POST',
      headers: { Connection: 'close' },
    });
    assert.equal(response.status, 200);
    await response.json();
    const error = await done;
    assert.ok(error instanceof Error);
    assert.match(error.message, /close failure/);
    assert.equal(existsSync(socket), false);
    assert.equal(existsSync(`${socket}.lock`), false);
    assert.equal(process.umask(), originalMask);
  } finally {
    process.umask(originalMask);
    rmSync(home, { recursive: true, force: true });
  }
});
test('poll errors remain visible through status and periodic polling recovers without restart', async () => {
  const home = mkdtempSync('/tmp/org-server-poll-');
  const socket = join(home, 'org.sock');
  let fail = true;
  const done = runLocalDaemon(socket, 20, () => ({
    dispatch: () => {
      if (fail) throw new Error('temporary failure');
      return [];
    },
    deliveries: () => [],
    close: () => undefined,
  }));
  try {
    const readStatus = async () => {
      const response = await fetch('http://org.local/v1/status', {
        unix: socket,
        headers: { Connection: 'close' },
      });
      const value: unknown = await response.json();
      assert.ok(
        value !== null && typeof value === 'object' && 'state' in value && 'error' in value,
      );
      return value;
    };
    const initial = await readStatus();
    assert.equal(initial.state, 'degraded');
    assert.equal(initial.error, 'temporary failure');
    fail = false;
    let state: unknown = 'degraded';
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await readStatus();
      state = current.state;
      if (state === 'running') {
        assert.equal(current.error, null);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state, 'running');
  } finally {
    const stopped = await fetch('http://org.local/v1/stop', {
      unix: socket,
      method: 'POST',
      headers: { Connection: 'close' },
    });
    await stopped.json();
    await done;
    rmSync(home, { recursive: true, force: true });
  }
});
test('automatic wake-up tick never overlaps and shutdown drains it before closing adapters', async () => {
  const home = mkdtempSync('/tmp/org-server-wake-'),
    socket = join(home, 'org.sock');
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0,
    active = 0,
    closed = false;
  const done = runLocalDaemon(socket, 10, () => ({
    dispatch: () => [],
    deliveries: () => [],
    wakeUp: async () => {
      calls++;
      active++;
      try {
        await held;
      } finally {
        active--;
      }
    },
    shutdown: async () => {
      release?.();
    },
    close: () => {
      assert.equal(active, 0);
      closed = true;
    },
  }));
  try {
    await Bun.sleep(60);
    assert.equal(calls, 1);
    assert.equal(active, 1);
  } finally {
    const stopped = await fetch('http://org.local/v1/stop', {
      unix: socket,
      method: 'POST',
      headers: { Connection: 'close' },
    });
    await stopped.json();
    await done;
    assert.equal(closed, true);
    assert.equal(active, 0);
    rmSync(home, { recursive: true, force: true });
  }
});
test('shutdown error still drains the active wake-up before adapter close', async () => {
  const home = mkdtempSync('/tmp/org-server-wake-error-'),
    socket = join(home, 'org.sock');
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = false,
    closed = false;
  const done = runLocalDaemon(socket, 10, () => ({
    dispatch: () => [],
    deliveries: () => [],
    wakeUp: async () => {
      active = true;
      await held;
      active = false;
    },
    shutdown: async () => {
      setTimeout(() => release?.(), 60);
      throw new Error('shutdown failed');
    },
    close: () => {
      assert.equal(active, false);
      closed = true;
    },
  })).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await Bun.sleep(20);
    assert.equal(active, true);
    const response = await fetch('http://org.local/v1/stop', {
      unix: socket,
      method: 'POST',
      headers: { Connection: 'close' },
    });
    await response.json();
    const error = await done;
    assert.ok(error instanceof Error);
    assert.match(error.message, /shutdown failed/);
    assert.equal(closed, true);
    assert.equal(active, false);
  } finally {
    release?.();
    await done;
    rmSync(home, { recursive: true, force: true });
  }
});
