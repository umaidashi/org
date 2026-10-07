import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
import { createRoom } from '../src/rooms/domain.js';
import { createApprovalDecision, type Approval } from '../src/approvals/domain.js';
import type { Event } from '../src/events/domain.js';
import type { LinearAgentScope } from '../src/linear/agent-read.js';
import {
  requestTaskLinearUpdateApproval,
  executeApprovedTaskLinearUpdate,
} from '../src/linear/task-approval.js';

test('Task Linear execution rejects changed authority before claim and preserves uncertainty and recoverable immutable receipts', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const fault of [
    '',
    'pending',
    'reject',
    'actor',
    'digest',
    'scope',
    'capability',
    'version',
    'parent',
    'work-version',
    'read-owner',
    'read-archive',
    'read-message',
    'read-capability',
    'write-source',
    'write-capability',
    'claim-save',
    'transport',
    'receipt',
    'terminal',
    'reflection',
    'returned',
    'observation-save',
  ]) {
    const originalOwner = createAgent(
      {
        name: 'Owner',
        role: 'worker',
        runtime: 'claude',
        capabilities: ['can_read', 'can_write', 'can_access_network', 'can_contact_external'],
      },
      { id: 'owner', createdAt: '0' },
    );
    const originalWork = {
      ...createTask(
        { title: 'Existing', objective: 'Original' },
        { id: 'linear:issue:' + id, createdAt: '0' },
      ),
      externalRef: 'https://linear.app/org/issue/ORG-1/existing',
    };
    const originalTask = {
      ...createTask(
        {
          kind: 'execution_task',
          title: 'Propose',
          objective: 'Update',
          parentId: originalWork.id,
        },
        { id: 'execution', createdAt: '0' },
      ),
      owner: 'owner',
      status: 'assigned' as const,
      version: 1,
    };
    const originalRoom = createRoom(
      {
        title: 'Task',
        type: 'task',
        taskId: originalTask.id,
        participants: [{ kind: 'agent', id: 'owner' }],
      },
      { id: 'room', createdAt: '0' },
    );
    let owner = originalOwner,
      work = originalWork,
      task = originalTask,
      room = originalRoom;
    let content = JSON.stringify({
      version: 1,
      tool: 'linear-update',
      workItemVersion: 0,
      fields: { labelIds: [] },
    });
    let issue = {
      id,
      identifier: 'ORG-1',
      title: work.title,
      description: null,
      url: work.externalRef,
      labels: { nodes: [{ id }], pageInfo: { hasNextPage: false } },
    };
    let approval: Approval | undefined,
      activeFault = '',
      calls = 0,
      lookups = 0,
      writes = 0;
    let scopes: readonly LinearAgentScope[] = [
      { agentId: owner.id, issueIds: [id], apiKeyEnv: 'OWNER_KEY', effect: 'write' },
    ];
    const records: Event[] = [];
    const tasks = { get: (taskId: string) => (taskId === work.id ? work : task) };
    const agents = { list: () => [owner] };
    const rooms = {
      get: () => room,
      messages: () => [
        {
          id: 'message',
          roomId: room.id,
          sender: { kind: 'agent' as const, id: 'owner' },
          content,
          replyTo: null,
          metadata: {},
          createdAt: '0',
        },
      ],
    };
    const secrets = {
      getSecret: (actor: string, reference: string) => {
        lookups++;
        assert.equal(actor, 'owner');
        assert.ok(['linear:read', 'linear:write'].includes(reference));
        if (reference === 'linear:write' && activeFault === 'write-source')
          task = { ...task, version: 2 };
        if (reference === 'linear:write' && activeFault === 'write-capability')
          owner = { ...owner, capabilities: [] };
        return 'fixture-owner-key';
      },
    };
    const http = async (_url: string, init: RequestInit) => {
      calls++;
      assert.ok(typeof init.body === 'string');
      const body: unknown = JSON.parse(init.body);
      assert.ok(
        body && typeof body === 'object' && 'query' in body && typeof body.query === 'string',
      );
      if (body.query.startsWith('query ')) {
        if (activeFault === 'read-owner') task = { ...task, owner: 'other' };
        if (activeFault === 'read-archive') room = { ...room, archivedAt: 'now' };
        if (activeFault === 'read-message')
          content = JSON.stringify({
            version: 1,
            tool: 'linear-update',
            workItemVersion: 0,
            fields: { assigneeId: null },
          });
        if (activeFault === 'read-capability') owner = { ...owner, capabilities: [] };
        return Response.json({ data: { issue } });
      }
      writes++;
      assert.ok('variables' in body);
      assert.deepEqual(body.variables, { id, input: { labelIds: [] } });
      issue = { ...issue, labels: { nodes: [], pageInfo: { hasNextPage: false } } };
      if (
        activeFault === 'transport' ||
        activeFault === 'terminal' ||
        activeFault === 'observation-save'
      )
        throw Error('owned lost response');
      const result =
        activeFault === 'reflection'
          ? { ...issue, title: 'fixture-owner-key' }
          : activeFault === 'returned'
            ? { ...issue, labels: { nodes: [{ id }], pageInfo: { hasNextPage: false } } }
            : issue;
      return Response.json({ data: { issueUpdate: { success: true, issue: result } } });
    };
    const requested = await requestTaskLinearUpdateApproval(
      tasks,
      agents,
      rooms,
      { requestOnce: (r) => r },
      scopes,
      secrets,
      http,
      { taskId: task.id, expectedVersion: 1, roomId: room.id, messageId: 'message', key: 'update' },
      { id: 'approval', createdAt: 'same' },
    );
    assert.equal(requested.operation.kind, 'linear_issue_update');
    assert.ok(requested.operation.kind === 'linear_issue_update');
    approval = {
      request: requested,
      decision: createApprovalDecision(
        requested,
        { actor: { kind: 'human', id: 'reviewer' }, decision: 'approve', reason: 'Verified' },
        'same',
      ),
    };
    const approvals = {
      get: () => {
        assert.ok(approval);
        return approval;
      },
    };
    const events = {
      list: () => records,
      publish: (event: Event) => {
        if (records.some((e) => e.id === event.id)) throw Error('duplicate');
        if (
          (activeFault === 'claim-save' && event.type === 'linear.update.claimed') ||
          (activeFault === 'receipt' && event.type === 'linear.update.updated') ||
          (activeFault === 'terminal' && event.type !== 'linear.update.claimed') ||
          (activeFault === 'observation-save' && event.type === 'linear.update.observed')
        )
          throw Error('owned storage');
        records.push(event);
        return event;
      },
    };
    const run = (mode: 'apply' | 'observe') =>
      executeApprovedTaskLinearUpdate(
        tasks,
        agents,
        rooms,
        approvals,
        events,
        scopes,
        secrets,
        http,
        { taskId: originalTask.id, approvalId: 'approval' },
        () => 'same',
        mode,
      );
    calls = 0;
    lookups = 0;
    activeFault = fault;
    if (fault === 'pending') approval = { request: requested, decision: null };
    if (fault === 'reject')
      approval = {
        request: requested,
        decision: createApprovalDecision(
          requested,
          { actor: { kind: 'human', id: 'reviewer' }, decision: 'reject', reason: 'Declined' },
          'same',
        ),
      };
    if (fault === 'actor')
      approval = { ...approval, request: { ...requested, actor: { kind: 'agent', id: 'other' } } };
    if (fault === 'digest')
      approval = {
        ...approval,
        request: {
          ...requested,
          operation: { ...requested.operation, inputDigest: 'f'.repeat(64) },
        },
      };
    if (fault === 'scope')
      scopes = scopes.map((s) => ({
        agentId: s.agentId,
        issueIds: s.issueIds,
        apiKeyEnv: s.apiKeyEnv,
      }));
    if (fault === 'capability') owner = { ...owner, capabilities: ['can_read'] };
    if (fault === 'version') task = { ...task, version: 2 };
    if (fault === 'parent') task = { ...task, parentId: null };
    if (fault === 'work-version') work = { ...work, version: 1 };
    if (fault) await assert.rejects(() => run('apply'));
    else assert.equal((await run('apply')).type, 'linear.update.updated');
    const attempted = [
      '',
      'transport',
      'receipt',
      'terminal',
      'reflection',
      'returned',
      'observation-save',
    ].includes(fault);
    assert.equal(writes, attempted ? 1 : 0);
    assert.equal(records.filter((e) => e.type === 'linear.update.claimed').length, writes);
    if (
      [
        'pending',
        'reject',
        'actor',
        'digest',
        'scope',
        'capability',
        'version',
        'parent',
        'work-version',
      ].includes(fault)
    ) {
      assert.equal(calls, 0);
      assert.equal(lookups, 0);
    }
    if (attempted) {
      const before = [calls, lookups, writes];
      await assert.rejects(() => run('apply'));
      assert.deepEqual([calls, lookups, writes], before);
      if (fault === 'observation-save') {
        const count = records.length;
        await assert.rejects(() => run('observe'));
        assert.equal(records.length, count);
      }
      activeFault = '';
      work = { ...work, version: 3 };
      const recovered = await run('observe');
      assert.equal(recovered.type, fault ? 'linear.update.observed' : 'linear.update.updated');
      const stable = [calls, lookups, writes];
      assert.deepEqual(await run('observe'), recovered);
      assert.deepEqual([calls, lookups, writes], stable);
      owner = { ...owner, capabilities: [] };
      await assert.rejects(() => run('observe'));
      assert.deepEqual([calls, lookups, writes], stable);
    }
  }
});
