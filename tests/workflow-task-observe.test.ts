import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask, attachArtifact } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createEvent, type Event } from '../src/events/domain.js';
import type { TaskHistory } from '../src/tasks/port.js';
import {
  observeTaskWorkflow,
  recoverInterruptedTaskWorkflows,
} from '../src/workflows/task-observe.js';
import type { WorkflowStatus } from '../src/workflows/port.js';

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
  let executionStatus: WorkflowStatus = 'success';
  let returnedId = '14',
    statusRetarget = false;
  const run = (readyOnly = false) =>
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
        list: () => [...events.values()],
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
              assert.ok(
                current.status === 'running' || (readyOnly && current.status === 'blocked'),
              );
              assert.equal(executionId, '14');
              reads++;
              if (statusRetarget)
                current = changeTask(blocked, { title: 'changed during status' }, '4');
              return { id: returnedId, workflowId: 'flow', status: executionStatus };
            },
          };
        },
        approvedAgentRuntime: () => {
          throw new Error('Unexpected write factory');
        },
      },
      { taskId: 't', expectedVersion: blocked.version, readyOnly },
      async () => 'org://artifacts/proof',
      () => '4',
      () => 'artifact',
    );
  events.delete(uncertain.id);
  await assert.rejects(run);
  assert.equal(resolutions, 0);
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
  executionStatus = 'waiting';
  assert.deepEqual(await run(true), blocked);
  assert.equal(history.length, 2);
  assert.equal(events.size, 3);
  assert.equal(reads, 1);
  statusRetarget = true;
  await assert.rejects(() => run(true));
  current = blocked;
  statusRetarget = false;
  returnedId = 'foreign';
  await assert.rejects(() => run(true), /match/);
  returnedId = '14';
  executionStatus = 'unknown';
  await assert.rejects(() => run(true), /unknown/);
  assert.deepEqual(current, blocked);
  assert.equal(history.length, 2);
  reads = 0;
  executionStatus = 'success';
  const terminal = createEvent(
    {
      type: 'workflow.status_observed',
      source: 'workflow:n8n',
      payload: {
        requestId,
        host: context.host,
        workflowId: 'flow',
        executionId: '14',
        status: 'success',
        actorKind: 'system',
        actorId: 'host:workflow',
      },
    },
    { id: requestId + ':status:terminal', createdAt: 'previous' },
  );
  events.set(terminal.id, terminal);
  events.delete(uncertain.id);
  const result = await run();
  assert.equal(result.status, 'waiting_approval');
  assert.equal(result.outputArtifacts.length, 1);
  assert.equal(reads, 1);
  assert.equal(events.get(claim.id), claim);
  assert.equal(events.get(started.id), started);
  assert.equal(events.get(uncertain.id), undefined);
  assert.equal(events.get(terminal.id), terminal);
  await assert.rejects(run);
  assert.equal(reads, 1);
});

test('interrupted Workflow recovery preserves durable receipts before Task CAS and never retries an unknown invocation', () => {
  const task = changeTask(
    changeTask(
      createTask(
        { title: 'recover', objective: 'observe', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
      { owner: 'a' },
      '1',
    ),
    { status: 'running' },
    '2',
  );
  const requestId = 'workflow:task:' + createHash('sha256').update(task.id).digest('hex');
  const context = {
    host: 'https://n8n.example',
    workflowId: 'flow',
    inputDigest: 'a'.repeat(64),
    actorKind: 'agent',
    actorId: 'a',
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
  const events = new Map([claim, started].map((event) => [event.id, event]));
  let current = task,
    writes = 0,
    publications = 0,
    failPublish = true,
    failCas = false;
  const recover = () =>
    recoverInterruptedTaskWorkflows(
      {
        list: () => [current, { ...task, id: 'plain' }, { ...task, id: 'work', kind: 'work_item' }],
        update: (id, patch, at, version) => {
          assert.equal(id, 't');
          assert.equal(version, task.version);
          assert.ok(events.has(requestId + ':unconfirmed'));
          if (failCas) throw new Error('fixture CAS conflict');
          writes++;
          current = changeTask(current, patch, at);
          return current;
        },
      },
      {
        list: () => [...events.values()],
        publishOnce: (event) => {
          if (failPublish) throw new Error('fixture receipt failure');
          assert.ok(!events.has(event.id));
          publications++;
          events.set(event.id, event);
          return event;
        },
      },
      () => '3',
    );
  assert.throws(recover, /receipt failure/);
  assert.equal(writes, 0);
  assert.equal(events.size, 2);
  failPublish = false;
  failCas = true;
  assert.throws(recover, /CAS conflict/);
  assert.equal(writes, 0);
  assert.equal(publications, 1);
  const uncertain = events.get(requestId + ':unconfirmed');
  assert.equal(uncertain?.payload.phase, 'observation');
  assert.equal(uncertain?.payload.executionId, '14');
  failCas = false;
  recover();
  recover();
  assert.equal(current.status, 'blocked');
  assert.equal(writes, 1);
  assert.equal(publications, 1);
  assert.equal(events.get(requestId + ':unconfirmed'), uncertain);
  current = task;
  events.set(started.id, { ...started, source: 'foreign' });
  assert.throws(recover, /receipts invalid/);
  assert.equal(writes, 1);
  events.set(started.id, { ...started, payload: { ...started.payload, actorId: 'foreign' } });
  assert.throws(recover, /context/);
  assert.equal(writes, 1);
  events.delete(started.id);
  events.delete(requestId + ':unconfirmed');
  recoverInterruptedTaskWorkflows(
    {
      list: () => [task],
      update: (_id, patch, at, version) => {
        assert.equal(version, task.version);
        assert.deepEqual(patch, { status: 'blocked' });
        return changeTask(task, patch, at);
      },
    },
    {
      list: () => [claim],
      publishOnce: () => {
        throw new Error('Unknown execution must not fabricate a receipt');
      },
    },
    () => '4',
  );
});
