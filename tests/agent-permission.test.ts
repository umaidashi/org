import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createCapabilityChange } from '../src/agents/permissions.js';
import {
  createApprovalRequest,
  createApprovalDecision,
  requireApprovedPermission,
} from '../src/approvals/domain.js';
test('Approved permission applies only to the named Agent and exact revision', () => {
  const actor = { kind: 'human' as const, id: 'founder' };
  const request = createApprovalRequest(
    {
      key: 'key',
      actor,
      taskId: 'task',
      eventId: 'event',
      operation: {
        kind: 'agent_capabilities',
        agentId: 'worker',
        expectedRevision: 0,
        capabilities: ['can_run_shell'],
      },
    },
    { id: 'approval', createdAt: 'before' },
  );
  const approved = requireApprovedPermission({
    request,
    decision: createApprovalDecision(
      request,
      { actor, decision: 'approve', reason: 'Scope verified' },
      'approved',
    ),
  });
  const snapshot = { agentId: 'worker', revision: 0, capabilities: [] };
  const changed = createCapabilityChange(snapshot, approved, actor, 'applied');
  assert.equal(changed.revision, 1);
  assert.deepEqual(changed.capabilities, ['can_run_shell']);
  assert.equal(changed.approvalId, 'approval');
  assert.equal(changed.taskId, 'task');
  assert.equal(changed.eventId, 'event');
  assert.equal(changed.actor.id, 'founder');
  assert.match(changed.outputRef, /worker/);
  assert.throws(
    () => createCapabilityChange({ ...snapshot, agentId: 'other' }, approved, actor, 'applied'),
    /Agent/,
  );
  assert.throws(
    () => createCapabilityChange({ ...snapshot, revision: 1 }, approved, actor, 'applied'),
    /revision/,
  );
});
