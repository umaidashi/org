import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask, attachArtifact } from '../src/tasks/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createApprovalDecision, type Approval } from '../src/approvals/domain.js';
import { requestTaskWorkflowApproval } from '../src/workflows/task-approval.js';
import { buildWorkflowAudit } from '../src/audit/workflows.js';
import { resumeTaskWorkflow } from '../src/workflows/task-resume.js';
import type { TaskHistory } from '../src/tasks/port.js';
import type { Event } from '../src/events/domain.js';

test('resume rechecks native Approval and latest Task before resolving credentials and claims once before invoke', async () => {
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
  const original = changeTask(
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
  const waiting = changeTask(original, { status: 'waiting_approval' }, '3');
  let current = waiting,
    owner = agent,
    activeRoom = room;
  const history: TaskHistory[] = [
    { version: original.version, status: original.status, at: original.updatedAt, task: original },
  ];
  const request = requestTaskWorkflowApproval(
    { get: () => original },
    { list: () => [agent] },
    { get: () => room, messages: () => [message] },
    { requestOnce: (r) => r },
    {
      taskId: 't',
      roomId: 'r',
      messageId: 'm',
      expectedVersion: original.version,
      host: 'https://n8n.example',
      effect: 'write',
      phase: 'running',
    },
    { id: 'approval', createdAt: '3' },
  );
  let approval: Approval = { request, decision: null };
  let resolutions = 0,
    invokes = 0,
    retarget = false,
    statusFailure = false,
    terminalFailure = false,
    cancelDuringStatus = false;
  let controller = new AbortController();
  const events = new Map<string, Event>();
  const run = () =>
    resumeTaskWorkflow(
      {
        get: () => current,
        history: () => history,
        update: (_id, patch, at, version) => {
          assert.equal(version, current.version);
          current = changeTask(current, patch, at);
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
      { get: () => approval },
      {
        publish: (e) => {
          if (events.has(e.id)) throw new Error('Duplicate claim');
          events.set(e.id, e);
          return e;
        },
      },
      {
        host: 'https://n8n.example',
        workflows: [{ id: 'flow', effect: 'write' }],
        approvedAgentRuntime: async () => {
          resolutions++;
          if (retarget) current = changeTask(waiting, { title: 'changed' }, '4');
          return {
            invoke: async () => {
              invokes++;
              assert.ok([...events.values()].some((e) => e.type === 'workflow.requested'));
              return '14';
            },
            status: async () => {
              if (statusFailure) throw new Error('PRIVATE_STATUS_ERROR');
              if (cancelDuringStatus) {
                controller.abort();
                return { id: '14', workflowId: 'flow', status: 'running' as const };
              }
              return {
                id: '14',
                workflowId: 'flow',
                status: terminalFailure ? ('error' as const) : ('success' as const),
              };
            },
          };
        },
      },
      { taskId: 't', approvalId: 'approval', expectedVersion: waiting.version },
      async () => 'org://artifacts/proof',
      () => '4',
      () => 'artifact',
      controller.signal,
    );
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  approval = {
    request,
    decision: createApprovalDecision(
      request,
      { actor: { kind: 'human', id: 'founder' }, decision: 'approve', reason: 'checked' },
      '4',
    ),
  };
  approval = { ...approval, request: { ...request, taskId: 'another-task' } };
  await assert.rejects(run);
  assert.equal(resolutions, 0);
  approval = {
    request,
    decision: createApprovalDecision(
      request,
      { actor: { kind: 'human', id: 'founder' }, decision: 'approve', reason: 'checked' },
      '4',
    ),
  };
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
  assert.equal(invokes, 0);
  assert.equal(events.size, 0);
  retarget = false;
  current = waiting;
  const result = await run();
  assert.equal(result.status, 'waiting_approval');
  assert.equal(invokes, 1);
  assert.equal(result.outputArtifacts.length, 1);
  await assert.rejects(run);
  assert.equal(invokes, 1);
  // A fresh injected store models a separate invocation whose status transport fails.
  events.clear();
  current = waiting;
  statusFailure = true;
  await assert.rejects(run);
  assert.equal(current.status, 'failed');
  assert.ok([...events.values()].some((event) => event.type === 'workflow.unconfirmed'));
  assert.ok(!JSON.stringify([...events.values()]).includes('PRIVATE_STATUS_ERROR'));
  assert.ok(
    buildWorkflowAudit([...events.values()]).some(
      (entry) =>
        entry.result === 'unconfirmed' && entry.approvalId === 'approval' && entry.actor.id === 'a',
    ),
  );
  events.clear();
  current = waiting;
  statusFailure = false;
  terminalFailure = true;
  await assert.rejects(run);
  assert.equal(current.status, 'failed');
  assert.ok(
    buildWorkflowAudit([...events.values()]).some(
      (entry) => entry.tool === 'workflow.status' && entry.result === 'failed',
    ),
  );
  assert.ok(![...events.values()].some((event) => event.type === 'workflow.unconfirmed'));
  events.clear();
  current = waiting;
  terminalFailure = false;
  cancelDuringStatus = true;
  controller = new AbortController();
  await assert.rejects(run);
  assert.equal(current.status, 'failed');
  assert.ok([...events.values()].some((event) => event.type === 'workflow.unconfirmed'));
});
