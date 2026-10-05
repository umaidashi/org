import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createApprovalRequest, createApprovalDecision } from '../src/approvals/domain.js';
import { invokeApprovedWorkflow } from '../src/workflows/approved.js';
import type { Event } from '../src/events/domain.js';
test('approved Workflow binds exact operation and actor before one immutable claim, including uncertain outcomes', async () => {
  const input = { marker: 'PRIVATE_INPUT' },
    digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const operation = {
    kind: 'workflow_invocation' as const,
    host: 'https://n8n.example',
    workflowId: 'flow',
    inputDigest: digest,
    requestId: 'invoke',
    effect: 'write' as const,
  };
  const request = createApprovalRequest(
    {
      key: 'approval-key',
      actor: { kind: 'human', id: 'founder' },
      taskId: null,
      eventId: null,
      operation,
    },
    { id: 'approval', createdAt: 'before' },
  );
  const decision = createApprovalDecision(
    request,
    { actor: { kind: 'human', id: 'founder' }, decision: 'approve', reason: 'exact' },
    'now',
  );
  const events = new Map<string, Event>();
  let calls = 0;
  const bus = {
    publish: (e: Event) => {
      if (events.has(e.id)) throw new Error('Duplicate');
      events.set(e.id, e);
      return e;
    },
  };
  const runtime = {
    invoke: async () => {
      assert.ok(events.has('invoke'));
      calls++;
      return '13';
    },
  };
  const store = { get: () => ({ request, decision }) },
    args = {
      workflowId: 'flow',
      host: operation.host,
      input,
      effect: 'write' as const,
      approvalId: 'approval',
      actor: { kind: 'human' as const, id: 'founder' },
    };
  await assert.rejects(
    invokeApprovedWorkflow(
      { get: () => ({ request, decision: null }) },
      bus,
      runtime,
      args,
      { id: 'invoke', createdAt: 'now' },
      () => 'later',
    ),
    /approved/,
  );
  for (const changed of [
    { ...args, input: { marker: 'OTHER' } },
    { ...args, host: 'https://foreign.example' },
    { ...args, workflowId: 'other' },
    { ...args, effect: 'irreversible' as const },
    { ...args, actor: { kind: 'human' as const, id: 'other' } },
  ])
    await assert.rejects(
      invokeApprovedWorkflow(
        store,
        bus,
        runtime,
        changed,
        { id: 'invoke', createdAt: 'now' },
        () => 'later',
      ),
      /match/,
    );
  await assert.rejects(
    invokeApprovedWorkflow(
      store,
      bus,
      runtime,
      args,
      { id: 'other', createdAt: 'now' },
      () => 'later',
    ),
    /match/,
  );
  assert.equal(events.size, 0);
  assert.equal(calls, 0);
  const started = await invokeApprovedWorkflow(
    store,
    bus,
    runtime,
    args,
    { id: 'invoke', createdAt: 'now' },
    () => 'later',
  );
  assert.equal(started.payload.approvalId, 'approval');
  assert.equal(started.payload.effect, 'write');
  assert.ok(!JSON.stringify([...events.values()]).includes('PRIVATE_INPUT'));
  await assert.rejects(
    invokeApprovedWorkflow(
      store,
      bus,
      runtime,
      args,
      { id: 'invoke', createdAt: 'now' },
      () => 'later',
    ),
    /Duplicate/,
  );
  assert.equal(calls, 1);
  const failed = new Map<string, Event>(),
    failedBus = {
      publish: (e: Event) => {
        if (failed.has(e.id)) throw new Error('Duplicate');
        failed.set(e.id, e);
        return e;
      },
    };
  await assert.rejects(
    invokeApprovedWorkflow(
      store,
      failedBus,
      {
        invoke: async () => {
          throw new Error('private provider');
        },
      },
      args,
      { id: 'invoke', createdAt: 'now' },
      () => 'later',
    ),
  );
  assert.equal(failed.get('invoke:unconfirmed')?.payload.approvalId, 'approval');
  assert.ok(!JSON.stringify([...failed.values()]).includes('private provider'));
});
