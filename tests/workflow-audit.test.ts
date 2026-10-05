import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createEvent } from '../src/events/domain.js';
import { buildWorkflowAudit } from '../src/audit/workflows.js';
import { createApprovalRequest, createApprovalDecision } from '../src/approvals/domain.js';
import { buildAudit } from '../src/audit/domain.js';
test('Workflow Audit preserves native actor, claim causality, Approval and uncertain outcome without input bodies', () => {
  const payload = {
    workflowId: 'flow',
    host: 'https://n8n.example',
    inputDigest: 'a'.repeat(64),
    actorId: 'founder',
    actorKind: 'human',
    taskId: null,
    eventId: null,
    approvalId: 'approval',
    effect: 'write',
  };
  const requested = createEvent(
    { type: 'workflow.requested', source: 'workflow:n8n', payload },
    { id: 'request', createdAt: 'same' },
  );
  const started = createEvent(
    {
      type: 'workflow.started',
      source: 'workflow:n8n',
      payload: { ...payload, requestId: 'request', executionId: '13' },
    },
    { id: 'request:started', createdAt: 'same' },
  );
  const uncertain = createEvent(
    {
      type: 'workflow.unconfirmed',
      source: 'workflow:n8n',
      payload: { ...payload, requestId: 'request' },
    },
    { id: 'request:unconfirmed', createdAt: 'same' },
  );
  const entries = buildWorkflowAudit([started, requested, uncertain]);
  assert.equal(entries.length, 3);
  const audit = buildAudit([], [], entries);
  assert.deepEqual(
    audit.map((e) => e.result),
    ['pending', 'started', 'unconfirmed'],
  );
  assert.deepEqual(audit[0]?.actor, { kind: 'human', id: 'founder' });
  assert.equal(audit[0]?.approvalId, 'approval');
  assert.equal(audit[0]?.inputRef, 'org://workflow-inputs/' + 'a'.repeat(64));
  const approvalRequest = createApprovalRequest(
    {
      key: 'one',
      actor: { kind: 'human', id: 'founder' },
      taskId: null,
      eventId: null,
      operation: {
        kind: 'workflow_invocation',
        host: payload.host,
        workflowId: 'flow',
        inputDigest: payload.inputDigest,
        requestId: 'request',
        effect: 'write',
      },
    },
    { id: 'approval', createdAt: 'same' },
  );
  const approvalDecision = createApprovalDecision(
    approvalRequest,
    { actor: { kind: 'human', id: 'founder' }, decision: 'approve', reason: 'checked' },
    'same',
  );
  assert.deepEqual(
    buildAudit([{ request: approvalRequest, decision: approvalDecision }], [], entries).map(
      (e) => e.result,
    ),
    ['pending', 'approved', 'pending', 'started', 'unconfirmed'],
  );
  const tampered = { ...started, payload: { ...started.payload, actorId: 'foreign' } };
  assert.throws(() => buildWorkflowAudit([requested, tampered]), /match/);
  assert.deepEqual(
    buildWorkflowAudit([
      {
        ...requested,
        payload: { workflowId: 'flow', host: 'https://n8n.example', inputDigest: 'digest' },
      },
    ]),
    [],
  );
  const observed = createEvent(
    {
      type: 'workflow.status_observed',
      source: 'workflow:n8n',
      payload: {
        requestId: 'request',
        host: payload.host,
        workflowId: 'flow',
        executionId: '13',
        status: 'success',
        actorKind: 'system',
        actorId: 'host:workflow',
      },
    },
    { id: 'observed', createdAt: 'later' },
  );
  const rows = buildWorkflowAudit([requested, started, observed]);
  assert.equal(rows.at(-1)?.result, 'succeeded');
  assert.deepEqual(rows.at(-1)?.actor, { kind: 'system', id: 'host:workflow' });
});
