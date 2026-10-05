import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createApprovalRequest,
  createApprovalDecision,
  requireApprovedPermission,
} from '../src/approvals/domain.js';
import { SqliteApprovalStore } from '../src/approvals/sqlite.js';
import { buildAudit } from '../src/audit/domain.js';
test('Workflow operation approval fixes host, input digest and invocation identity without granting permission changes', () => {
  const store = new SqliteApprovalStore(':memory:');
  const request = createApprovalRequest(
    {
      key: 'operation',
      actor: { kind: 'human', id: 'founder' },
      taskId: null,
      eventId: null,
      operation: {
        kind: 'workflow_invocation',
        host: 'https://n8n.example',
        workflowId: 'flow',
        inputDigest: 'a'.repeat(64),
        requestId: 'workflow:approved:one',
        effect: 'write',
      },
    },
    { id: 'approval', createdAt: 'before' },
  );
  try {
    assert.deepEqual(store.requestOnce(request), request);
    assert.deepEqual(store.requestOnce({ ...request, id: 'retry', createdAt: 'later' }), request);
    assert.throws(
      () =>
        store.requestOnce({
          ...request,
          operation: { ...request.operation, inputDigest: 'b'.repeat(64) },
        }),
      /conflict/,
    );
    assert.throws(
      () =>
        createApprovalDecision(
          request,
          { actor: { kind: 'agent', id: 'worker' }, decision: 'approve', reason: 'self' },
          'now',
        ),
      /human/,
    );
    const approved = store.decide(
      request.id,
      {
        actor: { kind: 'human', id: 'founder' },
        decision: 'approve',
        reason: 'Checked exact operation',
      },
      'now',
    );
    assert.throws(() => requireApprovedPermission(approved), /operation/);
    assert.equal(buildAudit([approved], [])[0]?.tool, 'workflow.invoke.request');
    assert.throws(
      () =>
        store.decide(
          request.id,
          { actor: { kind: 'human', id: 'founder' }, decision: 'reject', reason: 'change' },
          'later',
        ),
      /conflict/,
    );
    assert.throws(
      () =>
        createApprovalRequest(
          { ...request, operation: { ...request.operation, inputDigest: 'invalid' } },
          request,
        ),
      /digest/,
    );
    for (const host of [
      'bad-host',
      'https://user:password@n8n.example',
      'https://n8n.example?token=secret',
      'https://n8n.example/',
    ])
      assert.throws(
        () =>
          createApprovalRequest({ ...request, operation: { ...request.operation, host } }, request),
        /host/,
      );
    assert.throws(
      () =>
        createApprovalRequest(
          { ...request, operation: { ...request.operation, credential: 'secret' } },
          request,
        ),
      /operation/,
    );
    assert.equal(store.get(request.id).request.operation.kind, 'workflow_invocation');
  } finally {
    store.close();
  }
});
