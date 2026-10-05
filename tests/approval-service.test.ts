import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { applyPermissionApproval } from '../src/approvals/service.js';
import { createApprovalRequest, createApprovalDecision } from '../src/approvals/domain.js';
test('Approval service refuses pending/rejected decisions before calling the permission writer', () => {
  const actor = { kind: 'human' as const, id: 'founder' };
  const request = createApprovalRequest(
    {
      key: 'key',
      actor,
      taskId: null,
      eventId: null,
      operation: {
        kind: 'agent_capabilities',
        agentId: 'worker',
        expectedRevision: 0,
        capabilities: [],
      },
    },
    { id: 'approval', createdAt: 'before' },
  );
  let calls = 0;
  const writer = {
    applyCapabilities: () => {
      calls++;
      throw new Error('writer invoked');
    },
  };
  assert.throws(
    () =>
      applyPermissionApproval(
        { get: () => ({ request, decision: null }) },
        writer,
        'approval',
        actor,
        'now',
      ),
    /approved/,
  );
  assert.throws(
    () =>
      applyPermissionApproval(
        {
          get: () => ({
            request,
            decision: createApprovalDecision(
              request,
              { actor, decision: 'reject', reason: 'Not needed' },
              'rejected',
            ),
          }),
        },
        writer,
        'approval',
        actor,
        'now',
      ),
    /approved/,
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      applyPermissionApproval(
        {
          get: () => ({
            request,
            decision: createApprovalDecision(
              request,
              { actor, decision: 'approve', reason: 'Verified' },
              'approved',
            ),
          }),
        },
        writer,
        'approval',
        actor,
        'now',
      ),
    /writer invoked/,
  );
  assert.equal(calls, 1);
});
