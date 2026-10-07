import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { createTask, changeTask, attachArtifact, type Task } from '../src/tasks/domain.js';
import type { TaskHistory } from '../src/tasks/port.js';
import { createRoom } from '../src/rooms/domain.js';
import {
  createApprovalDecision,
  createApprovalRequest,
  type Approval,
} from '../src/approvals/domain.js';
import { createEvent, type Event } from '../src/events/domain.js';
import { requestTaskLinearUpdateApproval } from '../src/linear/task-approval.js';
import { linearClaimPayload } from '../src/linear/operation.js';
import {
  resumeTaskLinearUpdate,
  recoverInterruptedTaskLinearUpdates,
} from '../src/linear/task-resume.js';
import type { LinearAgentScope } from '../src/linear/agent-read.js';

async function fixture(dependency = false) {
  const issueId = '11111111-1111-4111-8111-111111111111';
  const owner = createAgent(
    {
      name: 'Owner',
      role: 'worker',
      runtime: 'claude',
      capabilities: ['can_read', 'can_write', 'can_access_network', 'can_contact_external'],
    },
    { id: 'owner', createdAt: '0' },
  );
  const work = {
    ...createTask(
      { title: 'Existing', objective: 'Original' },
      { id: 'linear:issue:' + issueId, createdAt: '0' },
    ),
    externalRef: 'https://linear.app/org/issue/ORG-1/existing',
  };
  const pending = createTask(
    {
      kind: 'execution_task',
      title: 'Update',
      objective: 'Propose',
      parentId: work.id,
      ...(dependency ? { dependencies: ['dependency'] } : {}),
    },
    { id: 'execution', createdAt: '0' },
  );
  const assigned = changeTask(pending, { owner: owner.id }, '1');
  const running = changeTask(assigned, { status: 'running' }, '2');
  const waiting = changeTask(running, { status: 'waiting_approval' }, '3');
  const room = createRoom(
    {
      title: 'Task',
      type: 'task',
      taskId: running.id,
      participants: [{ kind: 'agent', id: owner.id }],
    },
    { id: 'room', createdAt: '0' },
  );
  const message = {
    id: 'message',
    roomId: room.id,
    sender: { kind: 'agent' as const, id: owner.id },
    content: JSON.stringify({
      version: 1,
      tool: 'linear-update',
      workItemVersion: 0,
      fields: { labelIds: [] },
    }),
    replyTo: null,
    metadata: {},
    createdAt: '2',
  };
  const scopes: readonly LinearAgentScope[] = [
    { agentId: owner.id, issueIds: [issueId], apiKeyEnv: 'OWNER_KEY', effect: 'write' },
  ];
  const issue = {
    id: issueId,
    identifier: 'ORG-1',
    title: work.title,
    description: null,
    url: work.externalRef,
    labels: { nodes: [], pageInfo: { hasNextPage: false } },
  };
  const request = await requestTaskLinearUpdateApproval(
    { get: (id) => (id === work.id ? work : running) },
    { list: () => [owner] },
    { get: () => room, messages: () => [message] },
    { requestOnce: (value) => value },
    scopes,
    { getSecret: () => 'fixture-key' },
    async () => Response.json({ data: { issue } }),
    {
      taskId: running.id,
      expectedVersion: running.version,
      roomId: room.id,
      messageId: message.id,
      key: 'proposal',
      phase: 'running',
    },
    { id: 'approval', createdAt: '2' },
  );
  const approval: Approval = {
    request,
    decision: createApprovalDecision(
      request,
      { actor: { kind: 'human', id: 'founder' }, decision: 'approve', reason: 'Checked' },
      '3',
    ),
  };
  const state = {
    task: waiting,
    work,
    owner,
    room,
    message,
    approval,
    scopes,
    history: [pending, assigned, running, waiting].map((task): TaskHistory => ({
      task,
      version: task.version,
      status: task.status,
      at: task.updatedAt,
    })),
    events: [] as Event[],
    reads: 0,
    writes: 0,
    lookups: 0,
    updates: 0,
    failUpdate: false,
    failStage: false,
    dependencyDone: true,
  };
  const tasks = {
    get: (id: string): Task =>
      id === 'dependency'
        ? { ...work, id, owner: owner.id, status: state.dependencyDone ? 'completed' : 'pending' }
        : id === work.id
          ? state.work
          : state.task,
    list: () => (state.task.status === 'running' ? [state.task] : []),
    history: () => state.history,
    update: (
      id: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      version?: number,
    ): Task => {
      assert.equal(id, state.task.id);
      assert.equal(version, state.task.version);
      if (state.failUpdate) throw new Error('fixture update failure');
      state.updates++;
      state.task = changeTask(state.task, patch, at);
      state.history.push({
        task: state.task,
        version: state.task.version,
        status: state.task.status,
        at,
      });
      return state.task;
    },
    stageExecutionResult: (
      id: string,
      artifact: Parameters<typeof attachArtifact>[1],
      version: number,
    ) => {
      assert.equal(id, state.task.id);
      assert.equal(version, state.task.version);
      if (state.failStage) throw new Error('fixture stage failure');
      state.task = changeTask(
        attachArtifact(state.task, artifact, 'output'),
        { status: 'waiting_approval' },
        artifact.createdAt,
      );
      state.history.push({
        task: state.task,
        version: state.task.version,
        status: state.task.status,
        at: artifact.createdAt,
      });
      return state.task;
    },
  };
  const approvals = { get: () => state.approval };
  const events = {
    list: () => state.events,
    publish: (event: Event) => {
      assert.ok(!state.events.some((e) => e.id === event.id));
      state.events.push(event);
      return event;
    },
  };
  const ports = {
    tasks,
    approvals,
    events,
    agents: { list: () => [state.owner] },
    rooms: { get: () => state.room, messages: () => [state.message] },
  };
  const run = (
    mode: 'apply' | 'observe',
    hooks?: { secret?: () => void; read?: () => void; save?: () => void; signal?: AbortSignal },
  ) =>
    resumeTaskLinearUpdate(
      tasks,
      ports.agents,
      ports.rooms,
      approvals,
      events,
      state.scopes,
      {
        getSecret: (actor, ref) => {
          state.lookups++;
          assert.equal(actor, owner.id);
          assert.ok(['linear:read', 'linear:write'].includes(ref));
          hooks?.secret?.();
          return 'fixture-key';
        },
      },
      async (_url, init) => {
        assert.equal(typeof init.body, 'string');
        if (typeof init.body !== 'string') throw new Error('fixture HTTP body missing');
        if (init.body.includes('mutation')) {
          state.writes++;
          return Response.json({ data: { issueUpdate: { success: true, issue } } });
        }
        state.reads++;
        hooks?.read?.();
        return Response.json({ data: { issue } });
      },
      { taskId: waiting.id, approvalId: request.id, expectedVersion: state.task.version },
      async () => {
        hooks?.save?.();
        return 'org://artifacts/' + 'a'.repeat(64);
      },
      () => 'later',
      mode,
      hooks?.signal,
    );
  return { state, ports, run, running, assigned };
}

test('Runtime Linear resume validates historical authority and never reads or writes rejected sources', async () => {
  for (const fault of [
    'pending',
    'reject',
    'missing-history',
    'history-status',
    'title',
    'owner',
    'parent',
    'scope',
    'capability',
    'archive',
    'digest',
    'version',
    'secret-change',
    'read-change',
    'cancel',
    'dependency',
    'read-dependency',
    'work-version',
    'stage',
    'save',
  ]) {
    const { state, run } = await fixture(['dependency', 'read-dependency'].includes(fault));
    if (fault === 'pending') state.approval = { request: state.approval.request, decision: null };
    if (fault === 'reject')
      state.approval = {
        ...state.approval,
        decision: createApprovalDecision(
          state.approval.request,
          { actor: { kind: 'human', id: 'founder' }, decision: 'reject', reason: 'No' },
          '3',
        ),
      };
    if (fault === 'missing-history')
      state.history = state.history.filter((h) => h.status !== 'running');
    if (fault === 'history-status')
      state.history = state.history.map((h) =>
        h.version === 2 ? { ...h, status: 'assigned' } : h,
      );
    if (fault === 'title') state.task = { ...state.task, title: 'Changed' };
    if (fault === 'owner') state.task = { ...state.task, owner: 'other' };
    if (fault === 'parent') state.task = { ...state.task, parentId: null };
    if (fault === 'version') state.task = { ...state.task, version: state.task.version + 1 };
    if (fault === 'scope') state.scopes = [];
    if (fault === 'capability') state.owner = { ...state.owner, capabilities: [] };
    if (fault === 'archive') state.room = { ...state.room, archivedAt: '3' };
    if (fault === 'digest') {
      assert.equal(state.approval.request.operation.kind, 'linear_issue_update');
      if (state.approval.request.operation.kind !== 'linear_issue_update')
        throw new Error('fixture');
      state.approval = {
        ...state.approval,
        request: {
          ...state.approval.request,
          operation: { ...state.approval.request.operation, inputDigest: 'b'.repeat(64) },
        },
      };
    }
    if (fault === 'dependency') state.dependencyDone = false;
    if (fault === 'work-version') state.work = { ...state.work, version: 1 };
    if (fault === 'stage') state.failStage = true;
    await assert.rejects(() =>
      run('apply', {
        ...(fault === 'secret-change'
          ? {
              secret: () => {
                state.task = { ...state.task, title: 'Changed during secret lookup' };
              },
            }
          : {}),
        ...(fault === 'read-dependency'
          ? {
              read: () => {
                state.dependencyDone = false;
              },
            }
          : {}),
        ...(fault === 'read-change'
          ? {
              read: () => {
                state.owner = { ...state.owner, capabilities: [] };
              },
            }
          : {}),
        ...(fault === 'save'
          ? {
              save: () => {
                throw new Error('fixture save failure');
              },
            }
          : {}),
        ...(fault === 'cancel' ? { signal: AbortSignal.abort() } : {}),
      }),
    );
    assert.equal(state.writes, ['stage', 'save'].includes(fault) ? 1 : 0, fault);
    assert.equal(
      state.reads,
      ['read-change', 'read-dependency', 'stage', 'save'].includes(fault) ? 1 : 0,
      fault,
    );
    if (!['secret-change', 'read-change', 'read-dependency', 'stage', 'save'].includes(fault))
      assert.equal(state.lookups, 0, fault);
    if (['stage', 'save'].includes(fault)) {
      assert.equal(state.task.status, 'blocked');
      state.failStage = false;
      state.work = { ...state.work, version: 7 };
      const recovered = await run('observe');
      assert.equal(recovered.status, 'waiting_approval');
      assert.equal(recovered.outputArtifacts.length, 1);
      assert.equal(state.writes, 1);
      assert.equal(state.reads, 1);
    }
  }
});

test('Linear startup recovery validates original claims and skips assigned management approvals', async () => {
  for (const fault of ['', 'assigned', 'forged', 'multiple', 'save']) {
    const { state, ports, assigned } = await fixture();
    state.task = ports.tasks.update(state.task.id, { status: 'running' }, '4', state.task.version);
    if (fault === 'assigned') {
      const request = state.approval.request;
      assert.equal(request.operation.kind, 'linear_issue_update');
      if (request.operation.kind !== 'linear_issue_update' || !request.operation.binding)
        throw new Error('fixture');
      state.approval = {
        ...state.approval,
        request: createApprovalRequest(
          {
            ...request,
            operation: {
              ...request.operation,
              binding: { ...request.operation.binding, taskVersion: assigned.version },
            },
          },
          request,
        ),
      };
    }
    const request = state.approval.request;
    if (request.operation.kind !== 'linear_issue_update') throw new Error('fixture');
    const payload = linearClaimPayload({ ...request, operation: request.operation });
    const claim = createEvent(
      { type: 'linear.update.claimed', source: 'linear:host', payload },
      { id: payload.claimId, createdAt: '4' },
    );
    state.events = [fault === 'forged' ? { ...claim, source: 'other' } : claim];
    if (fault === 'multiple') state.events.push({ ...claim, id: 'second' });
    if (fault === 'save') state.failUpdate = true;
    const recover = () =>
      recoverInterruptedTaskLinearUpdates(ports.tasks, ports.approvals, ports.events, () => '5');
    if (['forged', 'multiple', 'save'].includes(fault)) {
      assert.throws(recover);
      assert.equal(state.task.status, 'running');
    } else {
      recover();
      assert.equal(state.task.status, fault === 'assigned' ? 'running' : 'blocked');
    }
    assert.equal(state.lookups, 0);
    assert.equal(state.reads, 0);
    assert.equal(state.writes, 0);
  }
});

test('Runtime Linear observation rejects forged receipts and revoked authority without resending', async () => {
  for (const fault of ['claim', 'receipt', 'capability', 'source', 'save']) {
    const { state, ports, run } = await fixture();
    ports.tasks.update(state.task.id, { status: 'running' }, '4', state.task.version);
    ports.tasks.update(state.task.id, { status: 'blocked' }, '5', state.task.version);
    const request = state.approval.request;
    if (request.operation.kind !== 'linear_issue_update') throw new Error('fixture');
    const payload = linearClaimPayload({ ...request, operation: request.operation });
    const claim = createEvent(
      { type: 'linear.update.claimed', source: 'linear:host', payload },
      { id: payload.claimId, createdAt: '4' },
    );
    state.events = [fault === 'claim' ? { ...claim, source: 'other' } : claim];
    if (fault !== 'save')
      state.events.push(
        createEvent(
          {
            type: 'linear.update.updated',
            source: 'linear:host',
            payload: {
              ...payload,
              issueUrl: request.operation.issueUrl,
              outputDigest: fault === 'receipt' ? 'b'.repeat(64) : request.operation.inputDigest,
            },
          },
          { id: payload.claimId + ':updated', createdAt: '4' },
        ),
      );
    if (fault === 'capability') state.owner = { ...state.owner, capabilities: [] };
    if (fault === 'source') state.task = { ...state.task, objective: 'Changed' };
    const publish = ports.events.publish;
    if (fault === 'save')
      ports.events.publish = (event) => {
        if (event.type === 'linear.update.observed')
          throw new Error('fixture observation save failure');
        return publish(event);
      };
    await assert.rejects(() => run('observe'));
    assert.equal(state.writes, 0);
    assert.equal(state.task.outputArtifacts.length, 0);
    assert.equal(state.reads, fault === 'save' ? 1 : 0);
    if (fault === 'save') {
      assert.equal(state.task.status, 'blocked');
      ports.events.publish = publish;
      await run('observe');
      assert.equal(state.task.status, 'waiting_approval');
      assert.equal(state.reads, 2);
      assert.equal(state.writes, 0);
      assert.equal(
        state.events.filter((event) => event.type === 'linear.update.observed').length,
        1,
      );
    }
  }
});
