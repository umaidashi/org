import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { codexCommand, parseCodexTurn, runCodexTurn } from '../src/runtime/codex.js';

const agent = { id: 'agent-1', role: 'Reviewer' };
const transcript = [
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'item.completed', item: { type: 'agent_message', text: 'Reviewed' } },
  { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } },
]
  .map((event) => JSON.stringify(event))
  .join('\n');
test('Codex command injects role and instructions via stdin and resumes only the requested session', () => {
  const command = codexCommand(
    { agent, message: '--dangerous', instruction: 'Check tests' },
    'codex',
  );
  assert.ok(command.argv.includes('--json'));
  assert.ok(command.argv.includes('sandbox_mode="read-only"'));
  assert.ok(command.input.includes('Reviewer'));
  assert.ok(command.input.includes('Check tests'));
  assert.ok(command.input.includes('--dangerous'));
  assert.ok(!command.argv.includes('--dangerous'));
  const resumed = codexCommand(
    { agent, message: 'Continue', instruction: '', sessionId: 'thread-1' },
    'codex',
  );
  assert.ok(resumed.argv.includes('resume'));
  assert.ok(resumed.argv.includes('thread-1'));
  assert.throws(() =>
    codexCommand({ agent, message: 'x', instruction: '', sessionId: '--last' }, 'codex'),
  );
});
test('Codex response requires a completed turn and rejects protocol failures or inconsistent sessions', () => {
  assert.deepEqual(parseCodexTurn(transcript), { sessionId: 'thread-1', text: 'Reviewed' });
  for (const bad of [
    '{}',
    'not json',
    transcript.replace('turn.completed', 'turn.failed'),
    transcript.split('\n').slice(0, 2).join('\n'),
  ])
    assert.throws(() => parseCodexTurn(bad));
  assert.throws(() => parseCodexTurn(transcript, 'another-thread'));
});

test('Codex turn runner uses the injected process boundary and never accepts failed process output', async () => {
  const turn = { agent, message: 'Review', instruction: 'Check tests' };
  const options = {
    executable: 'codex',
    cwd: '/tmp',
    env: {},
    timeoutMs: 2000,
    maxOutputBytes: 1024,
  };
  const result = await runCodexTurn(
    async (input) => {
      assert.equal(input.cwd, '/tmp');
      assert.equal(input.argv[0], 'codex');
      assert.deepEqual(input.env, {});
      return { reason: 'exited', exitCode: 0, stdout: transcript, stderr: '' };
    },
    turn,
    options,
  );
  assert.equal(result.sessionId, 'thread-1');
  for (const reason of ['timeout', 'cancelled', 'output_limit'] as const)
    await assert.rejects(
      runCodexTurn(
        async () => ({ reason, exitCode: 0, stdout: transcript, stderr: '' }),
        turn,
        options,
      ),
    );
  await assert.rejects(
    runCodexTurn(
      async () => ({ reason: 'exited', exitCode: 1, stdout: transcript, stderr: '' }),
      turn,
      options,
    ),
  );
});

test('Codex resumed response cannot succeed without a completed assistant reply', () => {
  assert.throws(() => parseCodexTurn('{"type":"turn.completed"}', 'thread-1'));
  assert.throws(() =>
    parseCodexTurn('{"type":"thread.started","thread_id":"thread-1"}\n{"type":"turn.completed"}'),
  );
});

for (const sessionId of [undefined, 'thread-1'])
  test(`Codex ${sessionId === undefined ? 'start' : 'resume'} disables native shell execution before handing off to the process`, async () => {
    const input = {
      agent,
      message: 'work',
      instruction: 'Review',
      ...(sessionId === undefined ? {} : { sessionId }),
    };
    await runCodexTurn(
      async (processInput) => {
        for (const flag of [
          'features.shell_tool=false',
          'features.view_image=false',
          'features.hooks=false',
          'notify=[]',
          'features.apps=false',
          'features.plugins=false',
          'features.multi_agent=false',
          'web_search="disabled"',
        ]) {
          const index = processInput.argv.indexOf(flag);
          assert.ok(index > 0);
          assert.equal(processInput.argv[index - 1], '-c');
        }
        return { reason: 'exited', exitCode: 0, stdout: transcript, stderr: '' };
      },
      input,
      { executable: 'codex', cwd: '/tmp', env: {}, timeoutMs: 2000, maxOutputBytes: 4096 },
    );
  });
