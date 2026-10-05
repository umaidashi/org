import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask, attachArtifact } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createEvent, type Event } from '../src/events/domain.js';
import type { TaskHistory } from '../src/tasks/port.js';
import { observeTaskWorkflow } from '../src/workflows/task-observe.js';

test('pending Workflow observation validates execution chain before key lookup and uses status only after latest Task CAS', async () => {
  const task = changeTask(
    changeTask(
      createTask(
        { title: 'check', objective: 'observe', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
      { owner: 'a' },
      '1',
    ),
    { status: 'running' },
    '2',
  );
  const blocked = changeTask(task, { status: 'blocked' }, '3');
  let current = blocked;
  const agent = createAgent(
    {
      name: 'worker',
      role: 'check',
      runtime: 'codex',
      capabilities: ['can_read', 'can_delegate', 'can_access_network', 'can_contact_external'],
    },
    { id: 'a', createdAt: '0' },
  );
  let owner = agent;
  const room = createRoom(
    { title: 'task', type: 'task', taskId: 't', participants: [{ kind: 'agent', id: 'a' }] },
    { id: 'r', createdAt: '0' },
  );
  let activeRoom = room;
  const message = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: '{"version":1,"tool":"workflow","workflowId":"flow","input":{}}',
    },
    { id: 'm', createdAt: '3' },
  );
  const requestId = 'workflow:task:' + createHash('sha256').update('t').digest('hex');
  const context = {
    workflowId: 'flow',
    host: 'https://n8n.example',
    inputDigest: createHash('sha256').update('{}').digest('hex'),
    actorId: 'a',
    actorKind: 'agent',
    taskId: 't',
    eventId: null,
    proposalRef: 'org://rooms/r/messages/m',
    approvalId: null,
    effect: 'read_only',
  };
  const claim = createEvent(
    { type: 'workflow.requested', source: 'workflow:n8n', payload: context },
    { id: requestId, createdAt: '2' },
  );
  const started = createEvent(
    {
      type: 'workflow.started',
      source: 'workflow:n8n',
      payload: { ...context, requestId, executionId: '14' },
    },
    { id: requestId + ':started', createdAt: '2' },
  );
  const uncertain = createEvent(
    {
      type: 'workflow.unconfirmed',
      source: 'workflow:n8n',
      payload: { ...context, requestId, executionId: '14', phase: 'observation' },
    },
    { id: requestId + ':unconfirmed', createdAt: '3' },
  );
  const events = new Map<string, Event>([claim, started, uncertain].map((e) => [e.id, e]));
  const history: TaskHistory[] = [
    { version: task.version, status: task.status, at: task.updatedAt, task },
    { version: blocked.version, status: blocked.status, at: blocked.updatedAt, task: blocked },
  ];
  let resolutions = 0,
    reads = 0,
    retarget = false;
  const run = () =>
    observeTaskWorkflow(
      {
        get: () => current,
        history: () => history,
        update: (_id, patch, at, version) => {
          assert.equal(version, current.version);
          current = changeTask(current, patch, at);
          history.push({ version: current.version, status: current.status, at, task: current });
          return current;
        },
        stageExecutionResult: (_id, artifact, version) => {
          assert.equal(version, current.version);
          current = changeTask(
            attachArtifact(current, artifact, 'output'),
            { status: 'waiting_approval' },
            artifact.createdAt,
          );
          return current;
        },
      },
      { list: () => [owner] },
      { get: () => activeRoom, messages: () => [message] },
      {
        get: () => {
          throw new Error('Unexpected write Approval');
        },
      },
      {
        get: (id) => {
          const e = events.get(id);
          if (!e) throw new Error('Missing receipt');
          return e;
        },
        publish: (e) => {
          assert.ok(!events.has(e.id));
          events.set(e.id, e);
          return e;
        },
      },
      {
        host: 'https://n8n.example',
        workflows: [{ id: 'flow', effect: 'read_only' }],
        agentRuntime: async () => {
          resolutions++;
          if (retarget) current = changeTask(blocked, { title: 'changed' }, '4');
          return {
            status: async (executionId) => {
              assert.equal(current.status, 'running');
              assert.equal(executionId, '14');
              reads++;
              return { id: '14', workflowId: 'flow', status: 'success' as const };
            },
          };
        },
        approvedAgentRuntime: () => {
          throw new Error('Unexpected write factory');
        },
      },
      { taskId: 't', expectedVersion: blocked.version },
      async () => 'org://artifacts/proof',
      () => '4',
      () => 'artifact',
    );
  events.set(uncertain.id, {
    ...uncertain,
    payload: { ...uncertain.payload, executionId: 'different' },
  });
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  events.set(uncertain.id, uncertain);
  events.set(started.id, {
    ...started,
    payload: { ...started.payload, proposalRef: 'org://rooms/r/messages/other' },
  });
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  events.set(started.id, started);
  events.set(uncertain.id, {
    ...uncertain,
    payload: { ...uncertain.payload, proposalRef: 'org://rooms/r/messages/other' },
  });
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  events.set(uncertain.id, uncertain);
  owner = { ...agent, capabilities: [] };
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  owner = agent;
  activeRoom = { ...room, archivedAt: 'closed' };
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  activeRoom = room;
  retarget = true;
  await assert.rejects(run);
  assert.equal(reads, 0);
  retarget = false;
  current = blocked;
  const result = await run();
  assert.equal(result.status, 'waiting_approval');
  assert.equal(result.outputArtifacts.length, 1);
  assert.equal(reads, 1);
  assert.equal(events.get(claim.id), claim);
  assert.equal(events.get(started.id), started);
  assert.equal(events.get(uncertain.id), uncertain);
  await assert.rejects(run);
  assert.equal(reads, 1);
});
