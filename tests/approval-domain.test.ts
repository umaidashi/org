import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createApprovalRequest,
  parseLinearIssueUpdateOperation,
  createApprovalDecision,
  requireApprovedPermission,
} from '../src/approvals/domain.js';
test('Linear Issue update approval freezes baseline and proposed input separately', () => {
  const input = {
    key: 'update',
    actor: { kind: 'human' as const, id: 'operator' },
    taskId: 'linear:issue:11111111-1111-4111-8111-111111111111',
    eventId: null,
    operation: {
      kind: 'linear_issue_update' as const,
      issueId: '11111111-1111-4111-8111-111111111111',
      issueUrl: 'https://linear.app/org/issue/ORG-1/existing',
      taskVersion: 0,
      inputDigest: 'a'.repeat(64),
      baselineDigest: 'b'.repeat(64),
    },
  };
  const identity = { id: 'update-approval', createdAt: 'now' };
  assert.deepEqual(createApprovalRequest(input, identity).operation, input.operation);
  for (const invalid of [
    { ...input, actor: { kind: 'agent' as const, id: 'worker' } },
    { ...input, taskId: 'other' },
    { ...input, eventId: 'event' },
    ...[
      { baselineDigest: '' },
      { baselineDigest: 'B'.repeat(64) },
      { inputDigest: 'bad' },
      { taskVersion: -1 },
      { issueId: 'ORG-1' },
      { issueUrl: input.operation.issueUrl + '?key=x' },
      { title: 'raw content' },
    ].map((patch) => ({ ...input, operation: { ...input.operation, ...patch } })),
  ])
    assert.throws(() => createApprovalRequest(invalid, identity));
});
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

test('Linear comment approval pins human, existing Issue, Task version and body digest', () => {
  const input = {
    key: 'linear-comment',
    actor: { kind: 'human' as const, id: 'operator' },
    taskId: 'linear:issue:11111111-1111-4111-8111-111111111111',
    eventId: null,
    operation: {
      kind: 'linear_comment' as const,
      issueId: '11111111-1111-4111-8111-111111111111',
      issueUrl: 'https://linear.app/org/issue/ORG-1/existing',
      commentId: '22222222-2222-4222-8222-222222222222',
      taskVersion: 0,
      inputDigest: 'a'.repeat(64),
    },
  };
  const identity = { id: 'approval', createdAt: 'now' };
  const request = createApprovalRequest(input, identity);
  assert.deepEqual(request.operation, input.operation);
  assert.throws(() =>
    createApprovalRequest({ ...input, actor: { kind: 'agent', id: 'a' } }, identity),
  );
  assert.throws(() => createApprovalRequest({ ...input, taskId: 'other' }, identity));
  assert.throws(() => createApprovalRequest({ ...input, eventId: 'e' }, identity));
  for (const operation of [
    { ...input.operation, commentId: 'not-uuid' },
    { ...input.operation, issueId: 'ORG-1' },
    { ...input.operation, taskVersion: -1 },
    { ...input.operation, inputDigest: 'bad' },
    { ...input.operation, issueUrl: 'https://evil.test/issue/ORG-1' },
    { ...input.operation, issueUrl: input.operation.issueUrl + '?key=x' },
    { ...input.operation, extra: true },
  ])
    assert.throws(() => createApprovalRequest({ ...input, operation }, identity));
});

test('Linear Artifact approval pins existing WorkItem, output Artifact reference and input digest', () => {
  const input = {
    key: 'artifact',
    actor: { kind: 'human' as const, id: 'operator' },
    taskId: 'linear:issue:11111111-1111-4111-8111-111111111111',
    eventId: null,
    operation: {
      kind: 'linear_artifact_link' as const,
      issueId: '11111111-1111-4111-8111-111111111111',
      issueUrl: 'https://linear.app/org/issue/ORG-1/existing',
      taskVersion: 1,
      artifactId: 'published',
      artifactUriDigest: 'b'.repeat(64),
      inputDigest: 'a'.repeat(64),
    },
  };
  const identity = { id: 'approval', createdAt: 'same' };
  assert.deepEqual(createApprovalRequest(input, identity).operation, input.operation);
  for (const invalid of [
    { ...input, actor: { kind: 'agent' as const, id: 'worker' } },
    { ...input, taskId: 'other' },
    { ...input, eventId: 'other' },
    { ...input, operation: { ...input.operation, artifactId: '' } },
    { ...input, operation: { ...input.operation, artifactId: 'x\0' } },
    { ...input, operation: { ...input.operation, taskVersion: -1 } },
    { ...input, operation: { ...input.operation, inputDigest: 'bad' } },
    { ...input, operation: { ...input.operation, issueUrl: input.operation.issueUrl + '?key=x' } },
    { ...input, operation: { ...input.operation, extra: true } },
  ])
    assert.throws(() => createApprovalRequest(invalid, identity));
});

test('Linear update approval freezes a closed canonical field mask while preserving legacy content approvals', () => {
  const input = {
    key: 'fields',
    actor: { kind: 'human' as const, id: 'operator' },
    taskId: 'linear:issue:11111111-1111-4111-8111-111111111111',
    eventId: null,
    operation: {
      kind: 'linear_issue_update' as const,
      issueId: '11111111-1111-4111-8111-111111111111',
      issueUrl: 'https://linear.app/org/issue/ORG-1/existing',
      taskVersion: 0,
      inputDigest: 'a'.repeat(64),
      baselineDigest: 'b'.repeat(64),
      fields: ['stateId', 'assigneeId', 'labelIds'] as const,
    },
  };
  const identity = { id: 'approval', createdAt: 'same' };
  const result = createApprovalRequest(input, identity);
  assert.deepEqual(result.operation, input.operation);
  for (const fields of [
    new Array<unknown>(1),
    [],
    ['other'],
    ['stateId', 'stateId'],
    ['labelIds', 'stateId'],
    'stateId',
    [null],
  ])
    assert.throws(() => parseLinearIssueUpdateOperation({ ...input.operation, fields }));
});
