import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseSandboxCommand } from '../src/sandbox/cli.js';
import { parseSandboxProposal } from '../src/sandbox/proposal.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
test('Sandbox proposal accepts only owner Agent code in the active Task Room and rejects privilege fields', () => {
  const task = changeTask(
    createTask(
      { title: 'task', objective: 'work', kind: 'execution_task' },
      { id: 't', createdAt: '0' },
    ),
    { owner: 'a' },
    '1',
  );
  const room = createRoom(
    {
      title: 'task',
      type: 'task',
      taskId: 't',
      participants: [
        { kind: 'agent', id: 'a' },
        { kind: 'human', id: 'h' },
      ],
    },
    { id: 'r', createdAt: '0' },
  );
  const proposal = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: JSON.stringify({ version: 1, tool: 'sandbox', code: 'console.log(7)' }),
    },
    { id: 'm', createdAt: '2' },
  );
  assert.equal(parseSandboxProposal(task, room, proposal), 'console.log(7)');
  for (const value of [
    { ...proposal, sender: { kind: 'human' as const, id: 'h' } },
    { ...proposal, roomId: 'other' },
    { ...proposal, content: '```json\n{}\n```' },
    {
      ...proposal,
      content: JSON.stringify({ version: 1, tool: 'sandbox', code: 'x', repo: '/private' }),
    },
    { ...proposal, content: JSON.stringify({ version: 1, tool: 'sandbox', code: '' }) },
  ])
    assert.throws(() => parseSandboxProposal(task, room, value));
  assert.throws(() => parseSandboxProposal(task, { ...room, taskId: 'other' }, proposal));
  assert.throws(() => parseSandboxProposal(task, { ...room, archivedAt: '3' }, proposal));
});

test('Sandbox CLI selects one proposal or code source while keeping limits and host policy outside the proposal', () => {
  const command = parseSandboxCommand([
    'sandbox',
    'run',
    'task',
    '--proposal',
    'message',
    '--writable',
    '--file',
    'result.txt',
  ]);
  assert.ok(command.action === 'run' && 'proposalId' in command);
  assert.equal(command.proposalId, 'message');
  assert.equal(command.policy.writable, true);
  assert.deepEqual(command.policy.files, ['result.txt']);
  for (const args of [
    ['--proposal', 'message', '--code', 'x'],
    ['--proposal', ''],
    ['--proposal', 'message', '--timeout-ms', '0'],
    ['--proposal', 'message', '--file', '../secret'],
  ])
    assert.throws(() => parseSandboxCommand(['sandbox', 'run', 'task', ...args]));
});
