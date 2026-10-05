import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { validateSandboxInput, authorizeSandboxTask } from '../src/sandbox/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
test('Sandbox accepts bounded TypeScript and relative artifacts but rejects path and resource escapes', () => {
  const input = {
    code: 'console.log(7)',
    writable: false,
    files: ['result.txt'],
    timeoutMs: 1000,
    maxOutputBytes: 4096,
  };
  assert.deepEqual(validateSandboxInput(input), input);
  for (const file of ['../secret', '/etc/passwd', 'nested/../secret', 'a//b', 'a\\b', '', 'a\0b'])
    assert.throws(() => validateSandboxInput({ ...input, files: [file] }), /path/i);
  for (const timeoutMs of [0, -1, NaN, Infinity, 3600001])
    assert.throws(() => validateSandboxInput({ ...input, timeoutMs }), /limit/i);
  assert.throws(() => validateSandboxInput({ ...input, code: 'x'.repeat(65537) }), /code/i);
});
test('Sandbox capability checks the assigned Task owner before any execution', () => {
  const task = changeTask(
    createTask(
      { title: 'Code', objective: 'Marker', kind: 'execution_task' },
      { id: 'task', createdAt: 'before' },
    ),
    { owner: 'worker' },
    'assigned',
  );
  const base = { name: 'worker', role: 'Code', runtime: 'codex' };
  const identity = { id: 'worker', createdAt: 'before' };
  const input = {
    code: 'console.log(7)',
    writable: false,
    files: [],
    timeoutMs: 1000,
    maxOutputBytes: 4096,
  };
  assert.throws(
    () => authorizeSandboxTask(task, createAgent(base, identity), input),
    /can_run_shell/,
  );
  const agent = createAgent({ ...base, capabilities: ['can_run_shell'] }, identity);
  authorizeSandboxTask(task, agent, input);
  assert.throws(() => authorizeSandboxTask(task, agent, { ...input, writable: true }), /can_write/);
  assert.throws(() => authorizeSandboxTask(task, agent, { ...input, repo: '/repo' }), /can_read/);
  assert.throws(
    () => authorizeSandboxTask({ ...task, kind: 'work_item' }, agent, input),
    /ExecutionTask/,
  );
  assert.throws(() => authorizeSandboxTask(task, { ...agent, id: 'other' }, input), /owner/);
});
