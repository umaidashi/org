import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { requestTaskWorkflowApproval } from '../src/workflows/task-approval.js';

test('native Task Workflow approval binds current owner version and immutable proposal without invoking external tools', () => {
  const task = changeTask(
    createTask(
      { title: 'check', objective: 'approve', kind: 'execution_task' },
      { id: 't', createdAt: '0' },
    ),
    { owner: 'a' },
    '1',
  );
  const agent = createAgent(
    {
      name: 'worker',
      role: 'check',
      runtime: 'codex',
      capabilities: [
        'can_read',
        'can_delegate',
        'can_access_network',
        'can_contact_external',
        'can_write',
      ],
    },
    { id: 'a', createdAt: '0' },
  );
  const room = createRoom(
    { title: 'task', type: 'task', taskId: 't', participants: [{ kind: 'agent', id: 'a' }] },
    { id: 'r', createdAt: '0' },
  );
  const message = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: JSON.stringify({
        version: 1,
        tool: 'workflow',
        workflowId: 'flow',
        input: { marker: 'input' },
      }),
    },
    { id: 'm', createdAt: '2' },
  );
  let writes = 0;
  let current = task;
  let owner = agent;
  let latestRoom = room;
  let latestMessage = message;
  const request = () =>
    requestTaskWorkflowApproval(
      { get: () => current },
      { list: () => [owner] },
      { get: () => latestRoom, messages: () => [latestMessage] },
      {
        requestOnce: (r) => {
          writes++;
          return r;
        },
      },
      {
        taskId: 't',
        roomId: 'r',
        messageId: 'm',
        expectedVersion: task.version,
        host: 'https://n8n.example',
        effect: 'write',
      },
      { id: 'approval', createdAt: '3' },
    );
  const result = request();
  assert.equal(result.actor.kind, 'agent');
  assert.equal(result.actor.id, 'a');
  assert.equal(result.taskId, 't');
  assert.equal(result.operation.kind, 'workflow_invocation');
  assert.deepEqual(result.operation.binding, {
    taskVersion: task.version,
    proposalRef: 'org://rooms/r/messages/m',
  });
  assert.equal(result.operation.workflowId, 'flow');
  assert.match(result.operation.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(writes, 1);
  current = { ...task, version: task.version + 1 };
  assert.throws(request);
  assert.equal(writes, 1);
  current = task;
  owner = { ...agent, capabilities: (agent.capabilities ?? []).filter((c) => c !== 'can_write') };
  assert.throws(request);
  assert.equal(writes, 1);
  owner = agent;
  current = { ...task, status: 'running' };
  assert.throws(request);
  current = task;
  current = { ...task, owner: 'other' };
  assert.throws(request);
  current = task;
  latestRoom = { ...room, archivedAt: 'closed' };
  assert.throws(request);
  latestRoom = room;
  latestMessage = { ...message, sender: { kind: 'human', id: 'founder' } };
  assert.throws(request);
  latestMessage = message;
  latestMessage = { ...message, content: 'not-json' };
  assert.throws(request);
  assert.equal(writes, 1);
});

test('Task-bound Approval keeps canonical immutable Message/version and rejects incomplete or human bindings', async () => {
  const { createApprovalRequest } = await import('../src/approvals/domain.js');
  const input = {
    key: 'request',
    actor: { kind: 'agent' as const, id: 'a' },
    taskId: 't',
    eventId: null,
    operation: {
      kind: 'workflow_invocation' as const,
      host: 'https://n8n.example',
      workflowId: 'flow',
      inputDigest: 'a'.repeat(64),
      requestId: 'request',
      effect: 'write' as const,
      binding: { taskVersion: 1, proposalRef: 'org://rooms/r/messages/m' },
    },
  };
  const original = createApprovalRequest(input, { id: 'approval', createdAt: 'now' });
  assert.deepEqual(original.operation.binding, input.operation.binding);
  for (const binding of [
    { taskVersion: -1, proposalRef: 'org://rooms/r/messages/m' },
    { taskVersion: 1, proposalRef: 'https://example.com' },
    { taskVersion: 1, proposalRef: 'org://rooms/r/messages/%ZZ' },
  ])
    assert.throws(() =>
      createApprovalRequest(
        { ...input, operation: { ...input.operation, binding } },
        { id: 'approval', createdAt: 'now' },
      ),
    );
  assert.throws(() =>
    createApprovalRequest(
      { ...input, actor: { kind: 'human', id: 'founder' } },
      { id: 'approval', createdAt: 'now' },
    ),
  );
  assert.throws(() =>
    createApprovalRequest({ ...input, taskId: null }, { id: 'approval', createdAt: 'now' }),
  );
  input.operation.binding.taskVersion = 9;
  assert.equal(original.operation.binding?.taskVersion, 1);
});
