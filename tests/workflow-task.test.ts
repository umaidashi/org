import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent, type Agent } from '../src/agents/domain.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import type { Event } from '../src/events/domain.js';
import { produceTaskWorkflowArtifact } from '../src/workflows/task.js';

test('Workflow Task rechecks latest owner permission and version before one scoped invocation and verified artifact', async () => {
  const task = changeTask(
    changeTask(
      createTask(
        { title: 'check', objective: 'verify', kind: 'execution_task' },
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
      capabilities: ['can_read', 'can_delegate', 'can_access_network', 'can_contact_external'],
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
        input: { marker: 'PRIVATE_INPUT' },
      }),
    },
    { id: 'm', createdAt: '3' },
  );
  let current = task,
    calls = 0,
    resolutions = 0,
    retarget = false;
  let owner: Agent = { ...agent, capabilities: [] };
  const events = new Map<string, Event>();
  const produce = () =>
    produceTaskWorkflowArtifact(
      { get: () => current },
      { list: () => [owner] },
      { get: () => room },
      {
        publish: (event: Event) => {
          if (events.has(event.id)) throw new Error('Duplicate Event');
          events.set(event.id, event);
          return event;
        },
      },
      task,
      message,
      {
        host: 'http://127.0.0.1:1',
        agentRuntime: async (actor: string, workflow: string) => {
          resolutions++;
          assert.equal(actor, 'a');
          assert.equal(workflow, 'flow');
          if (retarget) current = changeTask(task, { status: 'blocked' }, '3');
          return {
            invoke: async () => {
              calls++;
              assert.ok([...events.values()].some((e) => e.type === 'workflow.requested'));
              return '12';
            },
            status: async () => ({ id: '12', workflowId: 'flow', status: 'success' as const }),
          };
        },
      },
      async (bytes) => {
        const value: unknown = JSON.parse(Buffer.from(bytes).toString());
        assert.ok(
          value &&
            typeof value === 'object' &&
            'executionId' in value &&
            'status' in value &&
            'proposalRef' in value,
        );
        assert.equal(value.executionId, '12');
        assert.equal(value.status, 'success');
        assert.equal(value.proposalRef, 'org://rooms/r/messages/m');
        assert.ok(!Buffer.from(bytes).toString().includes('PRIVATE_INPUT'));
        return 'org://artifacts/proof';
      },
      () => '4',
      () => 'artifact',
    );
  await assert.rejects(produce(), /can_read/);
  assert.equal(resolutions, 0);
  owner = agent;
  retarget = true;
  await assert.rejects(produce(), /current running/);
  assert.equal(calls, 0);
  assert.equal(events.size, 0);
  retarget = false;
  current = task;
  assert.equal((await produce()).uri, 'org://artifacts/proof');
  assert.equal(calls, 1);
  await assert.rejects(produce(), /Duplicate Event/);
  assert.equal(calls, 1);
  assert.equal(events.size, 2);
  assert.ok(!JSON.stringify([...events.values()]).includes('PRIVATE_INPUT'));
});
