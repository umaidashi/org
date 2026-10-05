import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildAudit } from '../src/audit/domain.js';
import {
  createApprovalRequest,
  createApprovalDecision,
  requireApprovedPermission,
} from '../src/approvals/domain.js';
import { createCapabilityChange } from '../src/agents/permissions.js';
test('Audit preserves request-decision-application order when the clock timestamp is identical', () => {
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
    { id: 'approval', createdAt: 'now' },
  );
  const approval = {
    request,
    decision: createApprovalDecision(
      request,
      { actor, decision: 'approve', reason: 'Verified' },
      'now',
    ),
  };
  const change = createCapabilityChange(
    { agentId: 'worker', revision: 0, capabilities: [] },
    requireApprovedPermission(approval),
    actor,
    'now',
  );
  const entries = buildAudit([approval], [change]);
  assert.deepEqual(
    entries.map((entry) => entry.result),
    ['pending', 'approved', 'applied'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.approvalId),
    ['approval', 'approval', 'approval'],
  );
});

test('Audit keeps numeric Task history order when version nine and ten share a timestamp', () => {
  const base = {
    actor: { kind: 'agent' as const, id: 'worker' },
    taskId: 'task',
    eventId: null,
    tool: 'task.execution',
    inputRef: 'org://tasks/task',
    outputRef: 'org://tasks/task',
    at: 'same',
    approvalId: null,
  };
  const entries = buildAudit(
    [],
    [],
    [
      { ...base, id: 'task:task:9', result: 'started' },
      { ...base, id: 'task:task:10', result: 'succeeded' },
    ],
  );
  assert.deepEqual(
    entries.map((entry) => entry.result),
    ['started', 'succeeded'],
  );
});
