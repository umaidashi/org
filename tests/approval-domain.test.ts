import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createApprovalRequest,
  createApprovalDecision,
  requireApprovedPermission,
} from '../src/approvals/domain.js';
test('Permission changes remain unavailable until a matching human approval', () => {
  const request = createApprovalRequest(
    {
      key: 'change',
      actor: { kind: 'agent', id: 'worker' },
      taskId: null,
      eventId: null,
      operation: {
        kind: 'agent_capabilities',
        agentId: 'worker',
        expectedRevision: 0,
        capabilities: ['can_run_shell'],
      },
    },
    { id: 'approval', createdAt: 'before' },
  );
  assert.throws(() => requireApprovedPermission({ request, decision: null }), /approved/);
  const input = {
    actor: { kind: 'human' as const, id: 'founder' },
    decision: 'approve' as const,
    reason: 'Checked scope',
  };
  const decision = createApprovalDecision(request, input, 'now');
  assert.equal(
    requireApprovedPermission({ request, decision }).request.operation.agentId,
    'worker',
  );
  assert.throws(
    () =>
      createApprovalDecision(request, { ...input, actor: { kind: 'agent', id: 'worker' } }, 'now'),
    /human/,
  );
  assert.throws(
    () => requireApprovedPermission({ request, decision: { ...decision, approvalId: 'other' } }),
    /match/,
  );
  assert.throws(
    () =>
      requireApprovedPermission({
        request,
        decision: createApprovalDecision(request, { ...input, decision: 'reject' }, 'now'),
      }),
    /approved/,
  );
  assert.throws(
    () =>
      createApprovalRequest(
        { ...request, operation: { ...request.operation, expectedRevision: -1 } },
        { id: 'bad', createdAt: 'before' },
      ),
    /revision/,
  );
});
