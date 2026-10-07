import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { parseLinearAgentScopes, readAgentLinearIssue } from '../src/linear/agent-read.js';

test('Agent Linear read checks scoped credentials and live capabilities without host fallback', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const scope = { agentId: 'agent', issueIds: [id], apiKeyEnv: 'AGENT_LINEAR_KEY' };
  const original = createAgent(
    {
      name: 'Reader',
      role: 'reader',
      runtime: 'claude',
      capabilities: ['can_read', 'can_access_network', 'can_contact_external'],
    },
    { id: 'agent', createdAt: 'same' },
  );
  for (const fault of ['', 'agent', 'scope', 'capability', 'revoke', 'reflection']) {
    let agents = [original],
      calls = 0,
      lookups = 0;
    if (fault === 'agent') agents = [];
    if (fault === 'capability') agents = [{ ...original, capabilities: ['can_read'] }];
    const run = () =>
      readAgentLinearIssue(
        { list: () => agents },
        parseLinearAgentScopes([scope]),
        {
          getSecret: (actor, reference) => {
            lookups++;
            assert.deepEqual([actor, reference], ['agent', 'linear:read']);
            return 'fixture-agent-key';
          },
        },
        async (_url, init) => {
          calls++;
          assert.equal(new Headers(init.headers).get('Authorization'), 'fixture-agent-key');
          if (fault === 'revoke') agents = [{ ...original, capabilities: [] }];
          return Response.json({
            data: {
              issue: {
                id,
                identifier: 'ORG-1',
                title: fault === 'reflection' ? 'fixture-agent-key' : 'Existing',
                description: null,
                url: 'https://linear.app/org/issue/ORG-1/existing',
              },
            },
          });
        },
        {
          agentId: 'agent',
          issueId: fault === 'scope' ? '22222222-2222-4222-8222-222222222222' : id,
        },
      );
    if (fault) await assert.rejects(run);
    else assert.equal((await run()).id, id);
    assert.equal(calls, ['agent', 'scope', 'capability'].includes(fault) ? 0 : 1);
    assert.equal(lookups, calls);
  }
  for (const value of [
    null,
    {},
    [scope, scope],
    [{ ...scope, issueIds: ['ORG-1'] }],
    [{ ...scope, issueIds: [id, id] }],
    [{ ...scope, extra: true }],
    [{ ...scope, apiKeyEnv: 'bad-name' }],
  ])
    assert.throws(() => parseLinearAgentScopes(value));
});
