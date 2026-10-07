import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import {
  createApprovalDecision,
  type Approval,
  type ApprovalRequest,
} from '../src/approvals/domain.js';
import type { Event } from '../src/events/domain.js';
import { requestLinearCommentApproval, applyApprovedLinearComment } from '../src/linear/comment.js';
import * as linearComment from '../src/linear/comment.js';
import { buildLinearAudit } from '../src/audit/linear.js';
import { buildAudit } from '../src/audit/domain.js';

function fixture(body = 'private comment body') {
  const issueId = '11111111-1111-4111-8111-111111111111';
  const input = {
    taskId: 'linear:issue:' + issueId,
    expectedVersion: 0,
    actor: 'operator',
    body,
  };
  let saved: ApprovalRequest | undefined;
  const state = {
    task: {
      ...createTask(
        { title: 'existing', objective: 'work' },
        { id: input.taskId, createdAt: 'before' },
      ),
      externalRef: 'https://linear.app/org/issue/ORG-1/existing',
    },
    approval: undefined as Approval | undefined,
    events: [] as Event[],
    calls: 0,
    reads: 0,
    readLookups: 0,
    onRead: undefined as (() => void) | undefined,
    onWrite: undefined as (() => Promise<void>) | undefined,
    lookups: 0,
    failure: '',
    response: undefined as unknown,
  };
  const tasks = { get: () => state.task };
  const store = {
    list: () => (saved ? [{ request: saved, decision: null }] : []),
    requestOnce: (request: ApprovalRequest) => {
      saved = request;
      return request;
    },
  };
  const request = requestLinearCommentApproval(
    tasks,
    store,
    { ...input, key: 'key' },
    { id: '22222222-2222-4222-8222-222222222222', createdAt: 'same' },
  );
  const repeated = requestLinearCommentApproval(
    tasks,
    store,
    { ...input, key: 'key' },
    { id: '33333333-3333-4333-8333-333333333333', createdAt: 'later' },
  );
  assert.deepEqual(repeated.operation, request.operation);
  state.approval = {
    request,
    decision: createApprovalDecision(
      request,
      { actor: { kind: 'human', id: 'reviewer' }, decision: 'approve', reason: 'reviewed' },
      'same',
    ),
  };
  const events = {
    list: () => state.events,
    publish: (event: Event) => {
      if (state.events.some((e) => e.id === event.id)) throw new Error('duplicate claim');
      if (
        (state.failure === 'claim' && event.type === 'linear.comment.claimed') ||
        (state.failure === 'created' && event.type === 'linear.comment.created') ||
        (state.failure === 'terminal' && event.type !== 'linear.comment.claimed')
      )
        throw new Error('owned storage fault');
      if (state.failure === 'winner' && event.type === 'linear.comment.created') {
        state.events.push({ ...event, createdAt: 'winner' });
        throw new Error('owned race');
      }
      state.events.push(event);
      return event;
    },
  };
  const apply = (patch: Partial<typeof input> = {}) =>
    applyApprovedLinearComment(
      tasks,
      {
        get: () => {
          assert.ok(state.approval);
          return state.approval;
        },
      },
      events,
      {
        getSecret: (actor, reference) => {
          state.lookups++;
          assert.equal(actor, 'linear:host');
          assert.equal(reference, 'linear:write');
          if (state.failure === 'credential') throw new Error('fixture-key');
          if (state.failure === 'change')
            state.task = {
              ...changeTask(state.task, { title: 'changed' }, 'later'),
              externalRef: state.task.externalRef,
            };
          return 'fixture-key';
        },
      },
      async (_url, init) => {
        state.calls++;
        assert.deepEqual(
          state.events.map((event) => event.type),
          ['linear.comment.claimed'],
        );
        assert.equal(init.redirect, 'error');
        assert.ok(init.signal instanceof AbortSignal);
        assert.equal(typeof init.body, 'string');
        assert.ok(typeof init.body === 'string');
        const payload: unknown = JSON.parse(init.body);
        assert.ok(payload && typeof payload === 'object' && 'variables' in payload);
        if (state.failure === 'transport' || state.failure === 'terminal')
          throw new Error('fixture-key ' + input.body);
        await state.onWrite?.();
        assert.equal(request.operation.kind, 'linear_comment');
        return Response.json(
          state.response === undefined
            ? {
                data: {
                  commentCreate: {
                    success: true,
                    comment: {
                      id: '22222222-2222-4222-8222-222222222222',
                      body: input.body,
                      issue: { id: issueId },
                      url: state.task.externalRef + '#comment-22222222-2222-4222-8222-222222222222',
                    },
                  },
                },
              }
            : state.response,
        );
      },
      { ...input, ...patch, approvalId: request.id },
      () => 'same',
    );
  const observe = (patch: Partial<Pick<typeof input, 'taskId' | 'actor'>> = {}) =>
    linearComment.observeApprovedLinearComment(
      tasks,
      {
        get: () => {
          assert.ok(state.approval);
          return state.approval;
        },
      },
      events,
      {
        getSecret: (actor, reference) => {
          state.readLookups++;
          assert.equal(actor, 'linear:host');
          assert.equal(reference, 'linear:read');
          if (state.failure === 'credential') throw new Error('fixture-key');
          return 'fixture-key';
        },
      },
      async (url, init) => {
        state.reads++;
        assert.equal(url, 'https://api.linear.app/graphql');
        assert.ok(typeof init.body === 'string');
        const payload: unknown = JSON.parse(init.body);
        assert.ok(
          payload && typeof payload === 'object' && 'query' in payload && 'variables' in payload,
        );
        assert.equal(
          payload.query,
          'query KernelCommentStatus($id: String!) { comment(id: $id) { id body url issue { id } } }',
        );
        assert.deepEqual(payload.variables, { id: '22222222-2222-4222-8222-222222222222' });
        state.onRead?.();
        if (state.failure === 'transport') throw new Error('fixture-key ' + input.body);
        return Response.json(
          state.response === undefined
            ? {
                data: {
                  comment: {
                    id: '22222222-2222-4222-8222-222222222222',
                    body: input.body,
                    issue: { id: issueId },
                    url: 'https://linear.app/org/issue/ORG-1/existing#comment-22222222-2222-4222-8222-222222222222',
                  },
                },
              }
            : state.response,
        );
      },
      { taskId: input.taskId, actor: input.actor, ...patch, approvalId: request.id },
      () => 'same',
    );
  return { state, input, request, apply, observe };
}

test('Linear comment rejects unapproved or changed snapshots before credential lookup and HTTP', async () => {
  for (const rejection of [
    'pending',
    'reject',
    'actor',
    'body',
    'version',
    'task',
    'decision',
    'existing',
  ]) {
    const f = fixture();
    assert.ok(f.state.approval);
    if (rejection === 'pending') f.state.approval = { ...f.state.approval, decision: null };
    if (rejection === 'reject') {
      assert.ok(f.state.approval.decision);
      f.state.approval = {
        ...f.state.approval,
        decision: { ...f.state.approval.decision, decision: 'reject' },
      };
    }
    if (rejection === 'version')
      f.state.task = {
        ...changeTask(f.state.task, { title: 'changed' }, 'later'),
        externalRef: f.state.task.externalRef,
      };
    if (rejection === 'task')
      f.state.approval = { ...f.state.approval, request: { ...f.request, taskId: 'other' } };
    if (rejection === 'decision') {
      assert.ok(f.state.approval.decision);
      f.state.approval = {
        ...f.state.approval,
        decision: { ...f.state.approval.decision, approvalId: 'other' },
      };
    }
    if (rejection === 'existing')
      f.state.events.push({
        id: 'linear-comment:22222222-2222-4222-8222-222222222222',
        source: 'linear:host',
        type: 'linear.comment.claimed',
        payload: {},
        createdAt: 'same',
      });
    await assert.rejects(() =>
      f.apply(
        rejection === 'actor'
          ? { actor: 'other' }
          : rejection === 'body'
            ? { body: 'changed' }
            : {},
      ),
    );
    assert.equal(f.state.lookups, 0);
    assert.equal(f.state.calls, 0);
  }
});

test('Linear comment preserves one claim and uncertainty after transport or receipt failure', async () => {
  for (const failure of ['credential', 'change', 'claim', 'transport', 'created', 'terminal']) {
    const f = fixture();
    f.state.failure = failure;
    await assert.rejects(
      () => f.apply(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /fixture-key|private comment body/);
        return true;
      },
    );
    assert.equal(f.state.calls, ['transport', 'created', 'terminal'].includes(failure) ? 1 : 0);
    if (f.state.calls) {
      assert.equal(f.state.events[0]?.type, 'linear.comment.claimed');
      assert.equal(
        f.state.events.at(-1)?.type,
        failure === 'terminal' ? 'linear.comment.claimed' : 'linear.comment.unconfirmed',
      );
      f.state.failure = '';
      await assert.rejects(() => f.apply(), /already claimed/);
      assert.equal(f.state.calls, 1);
    } else assert.equal(f.state.events.length, 0);
  }
});

test('Linear comment rejects credential reflection or mismatched response and keeps original claim', async () => {
  const valid = {
    id: '22222222-2222-4222-8222-222222222222',
    body: 'private comment body',
    issue: { id: '11111111-1111-4111-8111-111111111111' },
    url: 'https://linear.app/org/issue/ORG-1/existing#comment-22222222-2222-4222-8222-222222222222',
  };
  for (const comment of [
    { ...valid, id: 'other' },
    { ...valid, body: 'other' },
    { ...valid, issue: null },
    { ...valid, issue: { id: 'other' } },
    { ...valid, url: 'https://evil.test' },
    { ...valid, url: 'https://linear.app/org/issue/ORG-2/other' },
    { ...valid, url: 'https://linear.app/other/issue/ORG-1/foreign' },
    { ...valid, body: 'fixture-key' },
  ]) {
    const f = fixture();
    f.state.response = { data: { commentCreate: { success: true, comment } } };
    await assert.rejects(() => f.apply());
    assert.equal(f.state.calls, 1);
    assert.deepEqual(
      f.state.events.map((event) => event.type),
      ['linear.comment.claimed', 'linear.comment.unconfirmed'],
    );
  }
  const f = fixture('fixture-key');
  await assert.rejects(() => f.apply(), /Invalid Linear input/);
  assert.equal(f.state.calls, 0);
});

test('Linear comment success Audit requires exact approved claim and preserves same-time causal order', async () => {
  const f = fixture();
  await f.apply();
  const approval = f.state.approval;
  assert.ok(approval);
  const [claim, created] = f.state.events;
  assert.ok(claim && created);
  const projected = buildLinearAudit(f.state.events, [approval]);
  const audit = buildAudit([approval], [], projected);
  assert.deepEqual(
    audit.map((entry) => entry.result),
    ['pending', 'approved', 'started', 'succeeded'],
  );
  assert.doesNotMatch(JSON.stringify(audit), /private comment body|fixture-key/);
  assert.throws(() => buildLinearAudit(f.state.events, []), /Approval/);
  assert.throws(() => buildLinearAudit([created], [approval]), /claim/);
  assert.throws(
    () =>
      buildLinearAudit(
        [claim, { ...created, payload: { ...created.payload, actorId: 'other' } }],
        [approval],
      ),
    /mismatch/,
  );
});

test('Linear comment status-only recovery accepts advanced Task versions and reuses one immutable receipt', async () => {
  const f = fixture();
  f.state.failure = 'transport';
  await assert.rejects(() => f.apply());
  f.state.failure = '';
  f.state.task = {
    ...changeTask(f.state.task, { title: 'new local title' }, 'later'),
    externalRef: f.state.task.externalRef,
  };
  const originals = f.state.events.slice();
  const recovered = await Promise.all([f.observe(), f.observe()]);
  assert.deepEqual(recovered[0], recovered[1]);
  assert.deepEqual(f.state.events.slice(0, 2), originals);
  assert.equal(f.state.calls, 1);
  assert.equal(f.state.task.version, 1);
  assert.equal(f.state.events.filter((e) => e.type === 'linear.comment.created').length, 1);
  const readCount = f.state.reads;
  assert.deepEqual(await f.observe(), recovered[0]);
  assert.equal(f.state.reads, readCount);
  assert.ok(f.state.approval);
  const audit = buildAudit(
    [f.state.approval],
    [],
    buildLinearAudit(f.state.events, [f.state.approval]),
  );
  assert.deepEqual(
    audit.map((e) => e.result),
    ['pending', 'approved', 'started', 'unconfirmed', 'succeeded'],
  );
  assert.doesNotMatch(
    JSON.stringify(f.state.events) + JSON.stringify(audit),
    /private comment body|fixture-key/,
  );
});

test('Linear comment observation rejects missing or forged authority before secret lookup', async () => {
  for (const fault of [
    'unclaimed',
    'pending',
    'reject',
    'actor',
    'task',
    'claim',
    'created',
    'target',
  ]) {
    const f = fixture();
    if (fault !== 'unclaimed') {
      f.state.failure = 'transport';
      await assert.rejects(() => f.apply());
      f.state.failure = '';
    }
    assert.ok(f.state.approval && f.state.approval.decision);
    const decision = f.state.approval.decision;
    if (fault === 'pending') f.state.approval = { ...f.state.approval, decision: null };
    if (fault === 'reject')
      f.state.approval = {
        ...f.state.approval,
        decision: { ...decision, decision: 'reject' },
      };
    if (fault === 'claim') {
      const claim = f.state.events[0];
      assert.ok(claim);
      f.state.events[0] = { ...claim, payload: { ...claim.payload, actorId: 'other' } };
    }
    if (fault === 'created') {
      const claim = f.state.events[0];
      assert.ok(claim);
      f.state.events.push({
        ...claim,
        id: claim.id + ':created',
        type: 'linear.comment.created',
        payload: { ...claim.payload, commentUrl: 'https://evil.test' },
      });
    }
    if (fault === 'target')
      f.state.task = {
        ...f.state.task,
        externalRef: 'https://linear.app/other/issue/ORG-2/foreign',
      };
    await assert.rejects(() =>
      f.observe(
        fault === 'actor' ? { actor: 'other' } : fault === 'task' ? { taskId: 'other' } : {},
      ),
    );
    assert.equal(f.state.readLookups, 0);
    assert.equal(f.state.reads, 0);
  }
});

test('Linear comment observation preserves uncertainty on mismatch, read failure or receipt failure', async () => {
  const valid = {
    id: '22222222-2222-4222-8222-222222222222',
    body: 'private comment body',
    issue: { id: '11111111-1111-4111-8111-111111111111' },
    url: 'https://linear.app/org/issue/ORG-1/existing#comment-22222222-2222-4222-8222-222222222222',
  };
  for (const fault of [
    'null',
    'id',
    'body',
    'issue',
    'url',
    'reflection',
    'transport',
    'credential',
    'created',
    'target-change',
  ]) {
    const f = fixture();
    f.state.failure = 'transport';
    await assert.rejects(() => f.apply());
    f.state.failure = fault;
    if (fault === 'target-change')
      f.state.onRead = () => {
        f.state.task = {
          ...f.state.task,
          externalRef: 'https://linear.app/other/issue/ORG-2/foreign',
        };
      };
    const comment =
      fault === 'null'
        ? null
        : fault === 'id'
          ? { ...valid, id: 'other' }
          : fault === 'body'
            ? { ...valid, body: 'changed' }
            : fault === 'issue'
              ? { ...valid, issue: null }
              : fault === 'url'
                ? { ...valid, url: 'https://linear.app/other/issue/ORG-1/foreign' }
                : fault === 'reflection'
                  ? { ...valid, body: 'fixture-key' }
                  : valid;
    f.state.response = { data: { comment } };
    const originals = f.state.events.slice();
    await assert.rejects(
      () => f.observe(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /fixture-key|private comment body/);
        return true;
      },
    );
    assert.deepEqual(f.state.events, originals);
    assert.equal(f.state.calls, 1);
    if (fault === 'created') {
      f.state.failure = '';
      await f.observe();
      assert.equal(f.state.events.at(-1)?.type, 'linear.comment.created');
    }
  }
  const winner = fixture();
  winner.state.failure = 'transport';
  await assert.rejects(() => winner.apply());
  winner.state.failure = 'winner';
  assert.equal((await winner.observe()).createdAt, 'winner');
  assert.equal(winner.state.calls, 1);
});

test('Linear comment apply reuses a success receipt recovered while its mutation response is in flight', async () => {
  const f = fixture();
  let observed: Event | undefined;
  f.state.onWrite = async () => {
    observed = await f.observe();
  };
  const applied = await f.apply();
  assert.deepEqual(applied, observed);
  assert.equal(f.state.calls, 1);
  assert.equal(f.state.reads, 1);
  assert.deepEqual(
    f.state.events.map((e) => e.type),
    ['linear.comment.claimed', 'linear.comment.created'],
  );
});
