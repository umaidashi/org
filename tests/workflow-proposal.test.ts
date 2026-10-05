import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseWorkflowProposal } from '../src/workflows/proposal.js';

test('Workflow proposal accepts only a bounded JSON object and denies privilege fields without leaking invalid body', () => {
  assert.deepEqual(
    parseWorkflowProposal('{"version":1,"tool":"workflow","workflowId":"flow","input":{}}'),
    { workflowId: 'flow', input: {} },
  );
  for (const content of [
    'PRIVATE_INVALID_BODY',
    JSON.stringify({
      version: 1,
      tool: 'workflow',
      workflowId: 'flow',
      input: {},
      apiKeyEnv: 'PRIVATE_ENV',
    }),
    JSON.stringify({ version: 1, tool: 'workflow', workflowId: 'flow', input: [] }),
    'x'.repeat(1048577),
  ])
    assert.throws(
      () => parseWorkflowProposal(content),
      (error) => error instanceof Error && error.message === 'Invalid Workflow proposal',
    );
});
