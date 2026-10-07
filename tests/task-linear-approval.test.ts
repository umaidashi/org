import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
import { createRoom } from '../src/rooms/domain.js';
import {
  requestTaskLinearUpdateApproval,
  parseTaskLinearProposal,
} from '../src/linear/task-approval.js';
import { createApprovalRequest, parseLinearTaskBinding } from '../src/approvals/domain.js';

test('Task Linear proposal validates closed modes and immutable Agent-only binding', () => {
  const taskId = 'linear:issue:11111111-1111-4111-8111-111111111111';
  const base = { version: 1, tool: 'linear-update', workItemVersion: 0 };
  assert.deepEqual(
    parseTaskLinearProposal(
      JSON.stringify({
        ...base,
        fields: { assigneeId: null, labelIds: [], priority: 0, title: 'Title', description: '' },
      }),
      taskId,
      'owner',
    ),
    {
      taskId,
      actor: 'owner',
      expectedVersion: 0,
      fields: { assigneeId: null, labelIds: [], priority: 0, title: 'Title', description: '' },
    },
  );
  for (const value of [
    null,
    {},
    { ...base, title: 'Title' },
    { ...base, title: 'Title', description: '', fields: {} },
    { ...base, fields: { labelIds: [] }, issueId: taskId },
    { ...base, workItemVersion: -1, fields: { labelIds: [] } },
    { ...base, fields: { stateId: 'ORG-1' } },
    { ...base, fields: { priority: 5 } },
  ])
    assert.throws(() => parseTaskLinearProposal(JSON.stringify(value), taskId, 'owner'));
  const binding = {
    taskId: 'execution',
    taskVersion: 1,
    proposalRef: 'org://rooms/room/messages/message',
  };
  for (const value of [
    null,
    { ...binding, extra: true },
    { ...binding, taskVersion: -1 },
    { ...binding, proposalRef: 'org://rooms/%72oom/messages/message' },
  ])
    assert.throws(() => parseLinearTaskBinding(value));
  const operation = {
    kind: 'linear_issue_update' as const,
    issueId: taskId.slice('linear:issue:'.length),
    issueUrl: 'https://linear.app/org/issue/ORG-1/existing',
    taskVersion: 0,
    inputDigest: 'a'.repeat(64),
    baselineDigest: 'b'.repeat(64),
    binding,
  };
  const input = {
    key: 'proposal',
    taskId,
    eventId: null,
    operation,
    actor: { kind: 'agent' as const, id: 'owner' },
  };
  assert.deepEqual(
    createApprovalRequest(input, { id: 'approval', createdAt: 'same' }).operation.binding,
    binding,
  );
  assert.throws(() =>
    createApprovalRequest(
      { ...input, actor: { kind: 'human', id: 'owner' } },
      { id: 'approval', createdAt: 'same' },
    ),
  );
});

test('Task Linear approval refuses source and capability changes during read without saving a request', async () => {
  const issueId = '11111111-1111-4111-8111-111111111111';
  const work = {
    ...createTask(
      { title: 'Existing', objective: 'Existing' },
      { id: 'linear:issue:' + issueId, createdAt: '0' },
    ),
    externalRef: 'https://linear.app/org/issue/ORG-1/existing',
  };
  const owner = createAgent(
    {
      name: 'Owner',
      role: 'worker',
      runtime: 'claude',
      capabilities: ['can_read', 'can_write', 'can_access_network', 'can_contact_external'],
    },
    { id: 'owner', createdAt: '0' },
  );
  const original = {
    ...createTask(
      { title: 'Propose', objective: 'Update', kind: 'execution_task', parentId: work.id },
      { id: 'execution', createdAt: '0' },
    ),
    owner: owner.id,
    status: 'assigned' as const,
    version: 1,
  };
  const room = createRoom(
    {
      title: 'Task',
      type: 'task',
      taskId: original.id,
      participants: [{ kind: 'agent', id: owner.id }],
    },
    { id: 'room', createdAt: '0' },
  );
  const content = JSON.stringify({
    version: 1,
    tool: 'linear-update',
    workItemVersion: 0,
    fields: { labelIds: [] },
  });
  for (const phase of ['assigned', 'running'] as const)
    for (const fault of [
      '',
      'version',
      'parent',
      'owner',
      'archive',
      'message',
      'capability',
      'reflection',
      'missing-capability',
      'status',
      'readonly-scope',
      'outside-issue',
      'secret-status',
    ]) {
      let task: import('../src/tasks/domain.js').Task = { ...original, status: phase },
        activeRoom = room,
        activeOwner = owner,
        body = content,
        calls = 0,
        saved = 0,
        lookups = 0;
      if (fault === 'missing-capability') activeOwner = { ...owner, capabilities: ['can_read'] };
      const run = (configuredPhase = phase) =>
        requestTaskLinearUpdateApproval(
          { get: (id) => (id === work.id ? work : task) },
          { list: () => [activeOwner] },
          {
            get: () => activeRoom,
            messages: () => [
              {
                id: 'message',
                roomId: room.id,
                sender: { kind: 'agent', id: owner.id },
                content: body,
                replyTo: null,
                metadata: {},
                createdAt: '0',
              },
            ],
          },
          {
            requestOnce: (r) => {
              saved++;
              return r;
            },
          },
          [
            {
              agentId: owner.id,
              issueIds: fault === 'outside-issue' ? [] : [issueId],
              apiKeyEnv: 'OWNER_KEY',
              ...(fault === 'readonly-scope' ? {} : { effect: 'write' as const }),
            },
          ],
          {
            getSecret: (actor, reference) => {
              lookups++;
              assert.deepEqual([actor, reference], [owner.id, 'linear:read']);
              if (fault === 'secret-status') task = { ...task, status: 'waiting_approval' };
              return 'fixture-owner-key';
            },
          },
          async () => {
            calls++;
            if (fault === 'status') task = { ...task, status: 'waiting_approval' };
            if (fault === 'version') task = { ...task, version: 2 };
            if (fault === 'parent') task = { ...task, parentId: null };
            if (fault === 'owner') task = { ...task, owner: 'other' };
            if (fault === 'archive') activeRoom = { ...room, archivedAt: 'now' };
            if (fault === 'message')
              body = JSON.stringify({
                version: 1,
                tool: 'linear-update',
                workItemVersion: 0,
                fields: { assigneeId: null },
              });
            if (fault === 'capability') activeOwner = { ...owner, capabilities: [] };
            return Response.json({
              data: {
                issue: {
                  id: issueId,
                  identifier: 'ORG-1',
                  title: fault === 'reflection' ? 'fixture-owner-key' : work.title,
                  description: null,
                  url: work.externalRef,
                  labels: { nodes: [], pageInfo: { hasNextPage: false } },
                },
              },
            });
          },
          {
            taskId: task.id,
            expectedVersion: 1,
            roomId: room.id,
            messageId: 'message',
            key: 'proposal',
            ...(configuredPhase === 'running' ? { phase: 'running' as const } : {}),
          },
          { id: 'approval', createdAt: 'same' },
        );
      if (phase === 'running') {
        await assert.rejects(() => run('assigned'));
        assert.equal(lookups, 0);
        assert.equal(calls, 0);
        assert.equal(saved, 0);
      }
      if (fault) await assert.rejects(() => run());
      else assert.equal((await run()).actor.kind, 'agent');
      assert.equal(saved, fault ? 0 : 1);
      assert.equal(
        calls,
        ['missing-capability', 'readonly-scope', 'outside-issue', 'secret-status'].includes(fault)
          ? 0
          : 1,
      );
      assert.equal(lookups, fault === 'secret-status' ? 1 : calls);
    }
});
