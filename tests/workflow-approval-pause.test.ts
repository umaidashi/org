import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { produceTaskWorkflowArtifact } from '../src/workflows/task.js';

test('write Workflow proposal waits for native human Approval before Agent credential resolution or invocation', async () => {
  const task = changeTask(
    changeTask(
      createTask(
        { title: 'write', objective: 'approval', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
      { owner: 'a' },
      '1',
    ),
    { status: 'running' },
    '2',
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
      content: '{"version":1,"tool":"workflow","workflowId":"flow","input":{}}',
    },
    { id: 'm', createdAt: '3' },
  );
  let requests = 0,
    resolutions = 0,
    saves = 0;
  const result = await produceTaskWorkflowArtifact(
    { get: () => task },
    { list: () => [agent] },
    { get: () => room },
    {
      publish: () => {
        throw new Error('Invoked before approval');
      },
    },
    task,
    message,
    {
      host: 'https://n8n.example',
      workflows: [{ id: 'flow', effect: 'write' }],
      requestApproval: () => {
        requests++;
      },
      agentRuntime: () => {
        resolutions++;
        throw new Error('Resolved before approval');
      },
    },
    async () => {
      saves++;
      return 'uri';
    },
    () => 'now',
    () => 'artifact',
  );
  assert.equal(result, null);
  assert.equal(requests, 1);
  assert.equal(resolutions, 0);
  assert.equal(saves, 0);
  let live = agent;
  let calls = 0;
  const afterLookup = produceTaskWorkflowArtifact(
    { get: () => task },
    { list: () => [live] },
    { get: () => room },
    { publish: (event) => event },
    task,
    message,
    {
      host: 'https://n8n.example',
      workflows: [{ id: 'flow', effect: 'write' }],
      approved: { approvalId: 'approval' },
      agentRuntime: async () => {
        live = {
          ...agent,
          capabilities: (agent.capabilities ?? []).filter((c) => c !== 'can_write'),
        };
        return {
          invoke: async () => {
            calls++;
            return '14';
          },
          status: async () => ({ id: '14', workflowId: 'flow', status: 'success' as const }),
        };
      },
    },
    async () => 'uri',
    () => 'now',
    () => 'artifact',
  );
  await assert.rejects(afterLookup);
  assert.equal(calls, 0);
});
