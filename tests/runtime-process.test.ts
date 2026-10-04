import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runProcess } from '../src/runtime/process.js';

test('process runner passes explicit input/environment and captures exit without shell interpretation', async () => {
  const result = await runProcess({
    argv: [
      process.execPath,
      '--no-env-file',
      '-e',
      'console.log(await Bun.stdin.text()); console.error(process.env.ORG_INPUT); process.exit(7)',
    ],
    input: '$(echo unsafe)',
    env: { ORG_INPUT: 'explicit' },
    cwd: '/tmp',
    timeoutMs: 2000,
    maxOutputBytes: 1024,
  });
  assert.equal(result.reason, 'exited');
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.trim(), '$(echo unsafe)');
  assert.equal(result.stderr.trim(), 'explicit');
});

test('process runner terminates timeout and cancellation and refuses oversized output', async () => {
  const base = {
    argv: [process.execPath, '--no-env-file', '-e', 'setInterval(() => {}, 100)'],
    input: '',
    env: {},
    cwd: '/tmp',
    timeoutMs: 50,
    maxOutputBytes: 1024,
  };
  assert.equal((await runProcess(base)).reason, 'timeout');
  const controller = new AbortController();
  controller.abort();
  assert.equal((await runProcess({ ...base, signal: controller.signal })).reason, 'cancelled');
  const running = new AbortController();
  const cancelTimer = setTimeout(() => running.abort(), 50);
  try {
    assert.equal(
      (await runProcess({ ...base, timeoutMs: 2000, signal: running.signal })).reason,
      'cancelled',
    );
  } finally {
    clearTimeout(cancelTimer);
  }
  const large = await runProcess({
    ...base,
    timeoutMs: 2000,
    argv: [process.execPath, '--no-env-file', '-e', 'console.log("x".repeat(10000))'],
  });
  assert.equal(large.reason, 'output_limit');
  assert.ok(Buffer.byteLength(large.stdout) <= 1024);
  await assert.rejects(runProcess({ ...base, argv: [] }));
});

test('process limits reject timer overflow and retain a UTF-8 output prefix within the byte budget', async () => {
  const base = {
    argv: [process.execPath, '--no-env-file', '-e', 'process.stdout.write("あ")'],
    input: '',
    env: {},
    cwd: '/tmp',
    timeoutMs: 2000,
    maxOutputBytes: 1,
  };
  await assert.rejects(runProcess({ ...base, timeoutMs: 2147483648 }), /timeout/i);
  for (const code of [
    'process.stdout.write("あ")',
    'process.stdout.write(Buffer.from([255, 255, 255]))',
  ]) {
    const result = await runProcess({
      ...base,
      argv: [process.execPath, '--no-env-file', '-e', code],
    });
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1);
  }
});
