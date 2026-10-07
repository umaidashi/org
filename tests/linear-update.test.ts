import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask } from '../src/tasks/domain.js';
import { createApprovalDecision, type Approval } from '../src/approvals/domain.js';
import type { Event } from '../src/events/domain.js';
import { buildLinearAudit } from '../src/audit/linear.js';
import {
  requestLinearUpdateApproval,
  applyApprovedLinearUpdate,
  observeApprovedLinearUpdate,
} from '../src/linear/update.js';
function fixture() {
  const issue = {
    id: '11111111-1111-4111-8111-111111111111',
    identifier: 'ORG-1',
    title: 'existing',
    description: null,
    url: 'https://linear.app/org/issue/ORG-1/existing',
  };
  const input = {
    taskId: 'linear:issue:' + issue.id,
    title: 'new',
    description: '',
    expectedVersion: 0,
    actor: 'operator',
  };
  const state = {
    task: {
      ...createTask(
        { title: 'existing', objective: 'original' },
        { id: input.taskId, createdAt: 'before' },
      ),
      externalRef: issue.url,
    },
    approval: undefined as Approval | undefined,
    events: [] as Event[],
    calls: 0,
    writes: 0,
    lookups: 0,
    fault: '',
    observation: undefined as unknown,
  };
  const tasks = { get: () => state.task };
  const secrets = {
    getSecret: (actor: string, reference: string) => {
      state.lookups++;
      assert.equal(actor, 'linear:host');
      assert.ok(['linear:read', 'linear:write'].includes(reference));
      if (state.fault === 'credential') throw Error('fixture-update-key');
      if (state.fault === 'local-change' && reference === 'linear:write')
        state.task = { ...state.task, version: 1 };
      return 'fixture-update-key';
    },
  };
  const request = async (_url: string, init: RequestInit) => {
    state.calls++;
    assert.ok(typeof init.body === 'string');
    const payload: unknown = JSON.parse(init.body);
    assert.ok(
      payload &&
        typeof payload === 'object' &&
        'query' in payload &&
        typeof payload.query === 'string',
    );
    if (payload.query.startsWith('query ')) {
      if (state.fault === 'read-local-change')
        state.task = {
          ...state.task,
          externalRef: 'https://linear.app/other/issue/ORG-1/existing',
        };
      return Response.json({
        data: {
          issue:
            state.observation !== undefined
              ? state.observation
              : state.fault === 'baseline'
                ? { ...issue, title: 'remote change' }
                : issue,
        },
      });
    }
    state.writes++;
    assert.equal(state.events[0]?.type, 'linear.update.claimed');
    if (state.fault === 'transport' || state.fault === 'terminal') throw Error('owned transport');
    return Response.json({
      data: {
        issueUpdate: {
          success: true,
          issue: {
            ...issue,
            title:
              state.fault === 'reflection'
                ? 'fixture-update-key'
                : state.fault === 'title'
                  ? 'other'
                  : input.title,
            description: state.fault === 'null' ? null : '',
            id: state.fault === 'identity' ? '22222222-2222-4222-8222-222222222222' : issue.id,
            url:
              state.fault === 'url'
                ? 'https://linear.app/org/issue/ORG-2/other'
                : state.fault === 'workspace'
                  ? 'https://linear.app/other/issue/ORG-1/new'
                  : state.fault === 'query'
                    ? issue.url + '?private=x'
                    : state.fault === 'fragment'
                      ? issue.url + '#'
                      : issue.url,
          },
        },
      },
    });
  };
  const events = {
    list: () => state.events,
    publish: (event: Event) => {
      if (state.events.some((e) => e.id === event.id)) throw Error('duplicate');
      if (
        (state.fault === 'claim' && event.type === 'linear.update.claimed') ||
        (state.fault === 'receipt' && event.type === 'linear.update.updated') ||
        (state.fault === 'observation-save' && event.type === 'linear.update.observed') ||
        (state.fault === 'terminal' && event.type !== 'linear.update.claimed')
      )
        throw Error('owned storage fault');
      state.events.push(event);
      return event;
    },
  };
  const prepare = async () => {
    const original = await requestLinearUpdateApproval(
      tasks,
      { requestOnce: (value) => value },
      secrets,
      request,
      { ...input, key: 'update' },
      { id: 'approval', createdAt: 'same' },
    );
    state.approval = {
      request: original,
      decision: createApprovalDecision(
        original,
        { actor: { kind: 'human', id: 'reviewer' }, decision: 'approve', reason: 'verified' },
        'same',
      ),
    };
  };
  const apply = (patch: Partial<typeof input> = {}) =>
    applyApprovedLinearUpdate(
      tasks,
      {
        get: () => {
          assert.ok(state.approval);
          return state.approval;
        },
      },
      events,
      secrets,
      request,
      { ...input, ...patch, approvalId: 'approval' },
      () => 'same',
    );
  const observe = (patch: Partial<{ taskId: string; actor: string; approvalId: string }> = {}) =>
    observeApprovedLinearUpdate(
      tasks,
      {
        get: () => {
          assert.ok(state.approval);
          return state.approval;
        },
      },
      events,
      secrets,
      request,
      { taskId: input.taskId, actor: input.actor, approvalId: 'approval', ...patch },
      () => 'same',
    );
  return { state, input, issue, prepare, apply, observe };
}
test('Linear Issue update refuses mismatched authority and input before credential lookup', async () => {
  for (const fault of ['pending', 'reject', 'actor', 'title', 'description', 'version']) {
    const f = fixture();
    await f.prepare();
    const approved = f.state.approval;
    assert.ok(approved);
    if (fault === 'pending') f.state.approval = { request: approved.request, decision: null };
    if (fault === 'reject')
      f.state.approval = {
        request: approved.request,
        decision: createApprovalDecision(
          approved.request,
          { actor: { kind: 'human', id: 'reviewer' }, decision: 'reject', reason: 'reject' },
          'same',
        ),
      };
    const calls = f.state.calls,
      lookups = f.state.lookups;
    await assert.rejects(() =>
      f.apply(
        fault === 'actor'
          ? { actor: 'other' }
          : fault === 'title'
            ? { title: 'other' }
            : fault === 'description'
              ? { description: 'other' }
              : fault === 'version'
                ? { expectedVersion: 1 }
                : {},
      ),
    );
    assert.equal(f.state.calls, calls);
    assert.equal(f.state.lookups, lookups);
    assert.equal(f.state.events.length, 0);
  }
});
test('Linear Issue update preserves baseline rejection, uncertainty and no replay across boundary faults', async () => {
  for (const fault of [
    'baseline',
    'credential',
    'local-change',
    'claim',
    'transport',
    'receipt',
    'terminal',
    'reflection',
    'identity',
    'url',
    'title',
    'null',
    'workspace',
    'query',
    'fragment',
  ]) {
    const f = fixture();
    await f.prepare();
    f.state.fault = fault;
    await assert.rejects(f.apply);
    const claimed = f.state.events.some((e) => e.type === 'linear.update.claimed');
    assert.equal(claimed, !['baseline', 'credential', 'local-change', 'claim'].includes(fault));
    assert.equal(f.state.writes, claimed ? 1 : 0);
    assert.equal(
      f.state.events.some((e) => e.type === 'linear.update.updated'),
      false,
    );
    if (claimed) {
      const calls = f.state.calls,
        lookups = f.state.lookups;
      f.state.fault = '';
      await assert.rejects(f.apply);
      assert.equal(f.state.calls, calls);
      assert.equal(f.state.lookups, lookups);
    }
  }
});
test('Linear Issue update success Audit binds output digest to immutable approval and claim', async () => {
  const f = fixture();
  await f.prepare();
  const original = JSON.stringify(f.state.task);
  const result = await f.apply();
  assert.equal(result.type, 'linear.update.updated');
  assert.equal(JSON.stringify(f.state.task), original);
  const approval = f.state.approval;
  assert.ok(approval);
  const audit = buildLinearAudit(f.state.events, [approval]);
  assert.deepEqual(
    audit.map((e) => e.result),
    ['started', 'succeeded'],
  );
  assert.equal(audit[1]?.outputRef, 'https://linear.app/org/issue/ORG-1/existing');
  const forged = f.state.events.map((e) =>
    e.id === result.id ? { ...e, payload: { ...e.payload, outputDigest: 'c'.repeat(64) } } : e,
  );
  assert.throws(() => buildLinearAudit(forged, [approval]));
  assert.doesNotMatch(JSON.stringify(audit), /fixture-update-key|original|"new"/);
});

test('Linear update observation validates approval and claim before read and preserves known immutable success', async () => {
  const f = fixture();
  await f.prepare();
  await assert.rejects(f.observe);
  assert.equal(f.state.calls, 1);
  const result = await f.apply();
  const before = [f.state.calls, f.state.lookups, f.state.writes];
  const authority = f.state.approval;
  assert.ok(authority);
  for (const decision of [
    null,
    createApprovalDecision(
      authority.request,
      { actor: { kind: 'human', id: 'reviewer' }, decision: 'reject', reason: 'not approved' },
      'same',
    ),
  ]) {
    f.state.approval = { request: authority.request, decision };
    await assert.rejects(f.observe);
    assert.deepEqual([f.state.calls, f.state.lookups, f.state.writes], before);
  }
  f.state.approval = authority;
  f.state.task = { ...f.state.task, version: 4 };
  assert.equal(await f.observe(), result);
  assert.deepEqual([f.state.calls, f.state.lookups, f.state.writes], before);
  for (const patch of [
    { actor: 'other' },
    { approvalId: 'other' },
    { taskId: 'linear:issue:22222222-2222-4222-8222-222222222222' },
  ])
    await assert.rejects(() => f.observe(patch));
  assert.deepEqual([f.state.calls, f.state.lookups, f.state.writes], before);
  f.state.events[0] = { ...result, id: 'linear-update:approval' };
  await assert.rejects(f.observe);
  assert.deepEqual([f.state.calls, f.state.lookups, f.state.writes], before);
});
test('Linear update observation rejects mismatched current contents and saves no proof on boundary failures', async () => {
  for (const fault of [
    'contents',
    'null',
    'identity',
    'workspace',
    'identifier',
    'query',
    'reflection',
    'read-local-change',
    'observation-save',
  ]) {
    const f = fixture();
    await f.prepare();
    f.state.fault = 'transport';
    await assert.rejects(f.apply);
    f.state.fault = fault;
    f.state.observation = {
      ...f.issue,
      title:
        fault === 'contents'
          ? 'wrong'
          : fault === 'reflection'
            ? 'fixture-update-key'
            : f.input.title,
      description: fault === 'null' ? null : f.input.description,
      id: fault === 'identity' ? '22222222-2222-4222-8222-222222222222' : f.issue.id,
      identifier: fault === 'identifier' ? 'ORG-2' : f.issue.identifier,
      url:
        fault === 'workspace'
          ? 'https://linear.app/other/issue/ORG-1/new'
          : fault === 'query'
            ? f.issue.url + '?private=x'
            : f.issue.url,
    };
    const before = JSON.stringify(f.state.events);
    await assert.rejects(f.observe);
    assert.equal(JSON.stringify(f.state.events), before);
    assert.equal(f.state.writes, 1);
    if (fault === 'observation-save') {
      f.state.fault = '';
      assert.equal((await f.observe()).type, 'linear.update.observed');
      assert.equal(f.state.writes, 1);
    }
  }
});
test('Linear update observation is distinct from mutation success, survives version progress and rejects forged receipts', async () => {
  const f = fixture();
  await f.prepare();
  f.state.fault = 'transport';
  await assert.rejects(f.apply);
  f.state.fault = '';
  f.state.task = { ...f.state.task, version: 2 };
  f.state.observation = {
    ...f.issue,
    title: f.input.title,
    description: f.input.description,
    url: 'https://linear.app/org/issue/ORG-1/new',
  };
  const original = JSON.stringify(f.state.task);
  const results = await Promise.all([f.observe(), f.observe()]);
  assert.equal(results[0], results[1]);
  assert.equal(f.state.events.filter((e) => e.type === 'linear.update.observed').length, 1);
  assert.equal(f.state.events.filter((e) => e.type === 'linear.update.updated').length, 0);
  const before = [f.state.calls, f.state.lookups, f.state.writes];
  assert.equal(await f.observe(), results[0]);
  assert.deepEqual([f.state.calls, f.state.lookups, f.state.writes], before);
  assert.equal(JSON.stringify(f.state.task), original);
  assert.ok(f.state.approval);
  const audit = buildLinearAudit(f.state.events, [f.state.approval]);
  assert.deepEqual(
    audit.map((e) => e.result),
    ['started', 'unconfirmed', 'observed'],
  );
  assert.doesNotMatch(JSON.stringify(audit), /fixture-update-key|"new"/);
  const receipt = results[0];
  assert.ok(receipt);
  f.state.events[f.state.events.length - 1] = {
    ...receipt,
    payload: { ...receipt.payload, outputDigest: 'c'.repeat(64) },
  };
  await assert.rejects(f.observe);
  assert.throws(() =>
    buildLinearAudit(
      f.state.events,
      [f.state.approval].filter((a): a is Approval => a !== undefined),
    ),
  );
  assert.deepEqual([f.state.calls, f.state.lookups, f.state.writes], before);
});
