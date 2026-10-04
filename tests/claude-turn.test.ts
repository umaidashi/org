import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { claudeCommand, parseClaudeTurn, runClaudeTurn } from '../src/runtime/claude.js';
const turn = {
  agent: { id: 'agent-1', role: 'Reviewer' },
  message: '--unsafe',
  instruction: 'Check tests',
};
const reply = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'session-1',
  result: 'Reviewed',
});
const options = {
  executable: 'claude',
  cwd: '/tmp',
  env: {},
  timeoutMs: 2000,
  maxOutputBytes: 1024,
};
test('Claude command preserves subscription authentication with isolated customizations and the chosen resume session', () => {
  const command = claudeCommand(turn, 'claude');
  assert.equal(command.input, '--unsafe');
  assert.ok(!command.argv.includes('--unsafe'));
  assert.ok(!command.argv.includes('--bare'));
  assert.ok(command.argv.includes('--safe-mode'));
  assert.ok(command.argv.includes('--disable-slash-commands'));
  assert.ok(command.argv.includes('--strict-mcp-config'));
  assert.equal(command.argv[command.argv.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.equal(command.argv[command.argv.indexOf('--settings') + 1], '{"disableAllHooks":true}');
  assert.ok(command.argv.includes('--print'));
  assert.equal(command.argv[command.argv.indexOf('--tools') + 1], '');
  const system = command.argv[command.argv.indexOf('--system-prompt') + 1];
  assert.ok(system?.includes('Reviewer') && system.includes('Check tests'));
  const resume = claudeCommand({ ...turn, sessionId: 'session-1' }, 'claude');
  assert.equal(resume.argv[resume.argv.indexOf('--resume') + 1], 'session-1');
  assert.throws(() => claudeCommand({ ...turn, sessionId: '--continue' }, 'claude'));
  assert.throws(() => claudeCommand({ ...turn, message: ' ' }, 'claude'));
});
test('Claude response rejects failed, missing and inconsistent result envelopes', () => {
  assert.deepEqual(parseClaudeTurn(reply), { sessionId: 'session-1', text: 'Reviewed' });
  for (const invalid of [
    'null',
    '{}',
    'not json',
    reply.replace('false', 'true'),
    reply.replace('success', 'error_max_turns'),
    reply.replace('"Reviewed"', '42'),
  ])
    assert.throws(() => parseClaudeTurn(invalid));
  assert.throws(() => parseClaudeTurn(reply, 'another-session'));
});
test('Claude turn uses process DI and rejects process failure even with a success-looking reply', async () => {
  const result = await runClaudeTurn(
    async (input) => {
      assert.equal(input.argv[0], 'claude');
      assert.deepEqual(input.env, {});
      return { reason: 'exited', exitCode: 0, stdout: reply, stderr: '' };
    },
    turn,
    options,
  );
  assert.equal(result.text, 'Reviewed');
  for (const reason of ['timeout', 'cancelled', 'output_limit'] as const)
    await assert.rejects(
      runClaudeTurn(
        async () => ({ reason, exitCode: 0, stdout: reply, stderr: '' }),
        turn,
        options,
      ),
    );
  await assert.rejects(
    runClaudeTurn(
      async () => ({ reason: 'exited', exitCode: 1, stdout: reply, stderr: '' }),
      turn,
      options,
    ),
  );
});

test('Claude resumed turn refreshes changed role and instruction instead of reusing a system prompt snapshot', () => {
  const command = claudeCommand(
    {
      ...turn,
      agent: { id: 'agent-1', role: 'Architect' },
      instruction: 'Plan migration',
      sessionId: 'session-1',
    },
    'claude',
  );
  assert.equal(command.argv[command.argv.indexOf('--system-prompt-snapshot') + 1], 'off');
  const system = command.argv[command.argv.indexOf('--system-prompt') + 1];
  assert.ok(system?.includes('Architect') && system.includes('Plan migration'));
});
