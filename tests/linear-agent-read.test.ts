import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { Event } from '../src/events/domain.js';
import { buildLinearAudit } from '../src/audit/linear.js';
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
  for (const fault of [
    '',
    'agent',
    'scope',
    'capability',
    'revoke',
    'reflection',
    'external',
    'start-audit',
    'complete-audit',
  ]) {
    let agents = [original],
      calls = 0,
      lookups = 0;
    if (fault === 'agent') agents = [];
    if (fault === 'capability') agents = [{ ...original, capabilities: ['can_read'] }];
    const events: Event[] = [];
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
          if (fault === 'external') return new Response('unavailable', { status: 500 });
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
        {
          events: {
            publish: (event) => {
              if (
                fault === 'start-audit' ||
                (fault === 'complete-audit' && event.type === 'linear.read.completed')
              )
                throw new Error('Audit write failed');
              events.push(event);
              return event;
            },
          },
          now: () => 'now',
          id: () => 'read-1',
        },
      );
    if (fault) await assert.rejects(run);
    else assert.equal((await run()).id, id);
    assert.equal(calls, ['agent', 'scope', 'capability', 'start-audit'].includes(fault) ? 0 : 1);
    assert.equal(lookups, calls);
    const audit = buildLinearAudit(events, []);
    assert.equal(
      audit.length,
      ['agent', 'scope', 'capability', 'start-audit'].includes(fault)
        ? 0
        : fault === 'complete-audit'
          ? 1
          : 2,
    );
    if (!fault) {
      assert.equal(audit[0]?.actor.id, 'agent');
      assert.equal(audit[0]?.tool, 'linear.read');
      assert.equal(audit[0]?.result, 'started');
      assert.equal(audit[1]?.result, 'succeeded');
      assert.equal(audit[1]?.outputRef, 'https://linear.app/org/issue/ORG-1/existing');
      const terminal = events[1],
        start = events[0];
      assert.ok(terminal && start);
      assert.throws(() => buildLinearAudit([terminal], []), /original/);
      for (const payload of [
        { ...terminal.payload, actorId: 'other' },
        { ...terminal.payload, result: 'approved' },
        {
          ...terminal.payload,
          outputRef: 'https://linear.app.evil.invalid/org/issue/ORG-1/existing',
        },
        { ...terminal.payload, extra: true },
      ])
        assert.throws(() => buildLinearAudit([start, { ...terminal, payload }], []));
    }
    assert.ok(!JSON.stringify(events).includes('fixture-agent-key'));
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

test('Agent Linear read Audit rejects identifier references because scoped producer requires canonical UUID', () => {
  const context = { actorId: 'agent', issueId: 'ORG-1', requestId: 'linear-read:invalid' };
  const events: Event[] = [
    {
      id: context.requestId,
      type: 'linear.read.started',
      source: 'linear:agent',
      payload: context,
      createdAt: 'now',
    },
    {
      id: context.requestId + ':completed',
      type: 'linear.read.completed',
      source: 'linear:agent',
      payload: { ...context, result: 'failed', outputRef: null },
      createdAt: 'later',
    },
  ];
  assert.throws(() => buildLinearAudit(events, []), /context/);
});
