import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { configuredDrivers } from '../src/runtime/config.js';

for (const kind of ['codex', 'claude'] as const)
  test(`${kind} refuses selected private environment reflected in text or provider identity`, async () => {
    const home = mkdtempSync('/tmp/org-reflection-');
    const previous = process.env.ORG_REFLECTION_FIXTURE;
    process.env.ORG_REFLECTION_FIXTURE = 'synthetic-private-token';
    try {
      const executable = home + '/driver.ts';
      writeFileSync(
        executable,
        `#!${process.execPath}\nawait Bun.stdin.text();
        const secret=process.env.ORG_REFLECTION_FIXTURE;
        const identity=process.argv.includes('--print');
        if(identity) console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:secret,result:'safe'}));
        else {console.log(JSON.stringify({type:'thread.started',thread_id:'safe-id'}));
          console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:secret}}));
          console.log(JSON.stringify({type:'turn.completed'}));}`,
        { mode: 0o700 },
      );
      const config = home + '/config.json';
      writeFileSync(
        config,
        JSON.stringify({ [kind]: { executable, cwd: home, env: ['ORG_REFLECTION_FIXTURE'] } }),
      );
      await assert.rejects(
        configuredDrivers(config)[kind]({
          agent: { id: 'agent', role: 'worker' },
          instruction: '',
          message: 'test',
        }),
        /Runtime output contains private environment value/,
      );
    } finally {
      if (previous === undefined) delete process.env.ORG_REFLECTION_FIXTURE;
      else process.env.ORG_REFLECTION_FIXTURE = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

for (const kind of ['codex', 'claude'] as const)
  test(`${kind} DI rejects decoded cross-profile values and exceptions while preserving safe failure reasons`, async () => {
    const home = mkdtempSync('/tmp/org-reflection-unit-');
    const previous = process.env.ORG_REFLECTION_FIXTURE;
    process.env.ORG_REFLECTION_FIXTURE = 'synthetic\nprivate';
    try {
      const config = home + '/config.json';
      const entry = { executable: '/unused', cwd: home, env: [] };
      writeFileSync(
        config,
        JSON.stringify({
          [kind]: entry,
          agents: { foreign: { [kind]: { ...entry, env: ['ORG_REFLECTION_FIXTURE'] } } },
        }),
      );
      const input = { agent: { id: 'agent', role: 'worker' }, instruction: '', message: 'test' };
      const output = (text: string, sessionId = 'safe-id') =>
        kind === 'claude'
          ? JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              session_id: sessionId,
              result: text,
            })
          : [
              { type: 'thread.started', thread_id: sessionId },
              { type: 'item.completed', item: { type: 'agent_message', text } },
              { type: 'turn.completed' },
            ]
              .map((event) => JSON.stringify(event))
              .join('\n');
      for (const stdout of [
        output('synthetic\nprivate'),
        output('safe', 'synthetic\nprivate'),
        'not-json synthetic\nprivate',
      ]) {
        const drivers = configuredDrivers(config, async () => ({
          reason: 'exited',
          exitCode: 0,
          stdout,
          stderr: '',
        }));
        await assert.rejects(
          drivers[kind](input),
          /Runtime output contains private environment value/,
        );
      }
      for (const error of [new Error('synthetic\nprivate'), 'synthetic\nprivate']) {
        await assert.rejects(
          configuredDrivers(config, async () => {
            throw error;
          })[kind](input),
          (failure: unknown) =>
            failure instanceof Error &&
            failure.message === 'Runtime output contains private environment value' &&
            failure.cause === undefined,
        );
      }
      const safeError = new Error('unrelated failure');
      await assert.rejects(
        configuredDrivers(config, async () => {
          throw safeError;
        })[kind](input),
        (failure: unknown) => failure === safeError,
      );
      for (const reason of ['exited', 'timeout', 'cancelled', 'output_limit'] as const) {
        await assert.rejects(
          configuredDrivers(config, async () => ({
            reason,
            exitCode: 1,
            stdout: 'synthetic\nprivate',
            stderr: 'synthetic\nprivate',
          }))[kind](input),
          new RegExp(`process failed: ${reason}, exit 1`),
        );
      }
      const safe = { sessionId: 'safe-id', text: 'safe response' };
      assert.deepEqual(
        await configuredDrivers(config, async () => ({
          reason: 'exited',
          exitCode: 0,
          stdout: output(safe.text),
          stderr: 'synthetic\nprivate',
        }))[kind](input),
        safe,
      );
    } finally {
      if (previous === undefined) delete process.env.ORG_REFLECTION_FIXTURE;
      else process.env.ORG_REFLECTION_FIXTURE = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

test('Runtime private matching includes short values but excludes empty and trusted public settings', async () => {
  const home = mkdtempSync('/tmp/org-reflection-settings-');
  const previous = {
    SHORT: process.env.ORG_REFLECTION_SHORT,
    EMPTY: process.env.ORG_REFLECTION_EMPTY,
    PUBLIC: process.env.ORG_REFLECTION_PUBLIC,
  };
  process.env.ORG_REFLECTION_SHORT = 'xy';
  process.env.ORG_REFLECTION_EMPTY = '';
  process.env.ORG_REFLECTION_PUBLIC = home;
  try {
    const path = home + '/config.json';
    const output = (text: string) =>
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'safe-id',
        result: text,
      });
    const input = { agent: { id: 'agent', role: 'worker' }, instruction: '', message: 'test' };
    writeFileSync(
      path,
      JSON.stringify({
        claude: {
          executable: '/unused',
          cwd: home,
          env: {
            TOKEN: 'ORG_REFLECTION_SHORT',
            EMPTY: 'ORG_REFLECTION_EMPTY',
            HOME: 'ORG_REFLECTION_PUBLIC',
          },
        },
      }),
    );
    await assert.rejects(
      configuredDrivers(path, async () => ({
        reason: 'exited',
        exitCode: 0,
        stdout: output('xy'),
        stderr: '',
      })).claude(input),
      /private environment value/,
    );
    assert.equal(
      (
        await configuredDrivers(path, async () => ({
          reason: 'exited',
          exitCode: 0,
          stdout: output(home),
          stderr: '',
        })).claude(input)
      ).text,
      home,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      const target = 'ORG_REFLECTION_' + name;
      if (value === undefined) delete process.env[target];
      else process.env[target] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
