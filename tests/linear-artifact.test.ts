import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, attachArtifact, changeTask } from '../src/tasks/domain.js';
import {
  createApprovalDecision,
  type Approval,
  type ApprovalRequest,
} from '../src/approvals/domain.js';
import { buildLinearAudit } from '../src/audit/linear.js';
import { buildAudit } from '../src/audit/domain.js';
import type { Event } from '../src/events/domain.js';
import * as artifactLink from '../src/linear/artifact.js';

function fixture(uri = 'https://github.com/example/repo/pull/1') {
  const issueId = '11111111-1111-4111-8111-111111111111';
  const input = {
    taskId: 'linear:issue:' + issueId,
    artifactId: 'published',
    title: 'Reviewed artifact',
    expectedVersion: 1,
    actor: 'operator',
  };
  const artifact = { id: 'published', uri, createdAt: 'before' };
  const state = {
    task: {
      ...attachArtifact(
        createTask(
          { title: 'existing', objective: 'work' },
          { id: input.taskId, createdAt: 'before' },
        ),
        artifact,
        'output',
      ),
      externalRef: 'https://linear.app/org/issue/ORG-1/existing',
    },
    artifacts: [artifact],
    approval: undefined as Approval | undefined,
    events: [] as Event[],
    credential: 'fixture-artifact-key',
    calls: 0,
    lookups: 0,
    failure: '',
    response: undefined as unknown,
  };
  const tasks = { get: () => state.task, artifacts: () => state.artifacts };
  const request = () =>
    artifactLink.requestLinearArtifactApproval(
      tasks,
      { requestOnce: (original: ApprovalRequest) => original },
      { ...input, key: 'key' },
      { id: 'approval', createdAt: 'same' },
    );
  const approve = () => {
    const original = request();
    state.approval = {
      request: original,
      decision: createApprovalDecision(
        original,
        {
          actor: { kind: 'human', id: 'reviewer' },
          decision: 'approve',
          reason: 'URL upsert checked',
        },
        'same',
      ),
    };
  };
  const apply = (patch: Partial<typeof input> = {}) =>
    artifactLink.applyApprovedLinearArtifact(
      tasks,
      {
        get: () => {
          assert.ok(state.approval);
          return state.approval;
        },
      },
      {
        list: () => state.events,
        publish: (event: Event) => {
          if (state.events.some((e) => e.id === event.id)) throw new Error('owned duplicate');
          if (
            (state.failure === 'claim' && event.type === 'linear.artifact.claimed') ||
            (state.failure === 'receipt' && event.type === 'linear.artifact.linked') ||
            (state.failure === 'terminal' && event.type !== 'linear.artifact.claimed')
          )
            throw new Error('owned storage fault');
          state.events.push(event);
          return event;
        },
      },
      {
        getSecret: (actor, reference) => {
          state.lookups++;
          assert.equal(actor, 'linear:host');
          assert.equal(reference, 'linear:write');
          if (state.failure === 'credential') throw new Error('fixture-artifact-key');
          if (state.failure === 'change')
            state.task = {
              ...changeTask(state.task, { title: 'changed' }, 'later'),
              externalRef: state.task.externalRef,
            };
          return state.credential;
        },
      },
      async (url, init) => {
        state.calls++;
        assert.equal(url, 'https://api.linear.app/graphql');
        assert.equal(init.redirect, 'error');
        assert.ok(init.signal instanceof AbortSignal);
        assert.equal(state.events[0]?.type, 'linear.artifact.claimed');
        assert.ok(typeof init.body === 'string');
        const payload: unknown = JSON.parse(init.body);
        assert.ok(payload && typeof payload === 'object' && 'variables' in payload);
        assert.deepEqual(payload.variables, { issueId, title: input.title, url: artifact.uri });
        if (state.failure === 'transport' || state.failure === 'terminal')
          throw new Error('fixture-artifact-key ' + input.title);
        return Response.json(
          state.response === undefined
            ? {
                data: {
                  attachmentCreate: {
                    success: true,
                    attachment: {
                      id: '22222222-2222-4222-8222-222222222222',
                      title: input.title,
                      url: artifact.uri,
                      issue: { id: issueId },
                    },
                  },
                },
              }
            : state.response,
        );
      },
      { ...input, ...patch, approvalId: 'approval' },
      () => 'same',
    );
  return { state, input, request, approve, apply, tasks };
}

test('Linear Artifact observation recovers a verified link after uncertainty without replaying mutation', async () => {
  const f = fixture();
  f.approve();
  f.state.failure = 'transport';
  await assert.rejects(f.apply);
  f.state.failure = '';
  f.state.task = {
    ...changeTask(f.state.task, { title: 'later title' }, 'later'),
    externalRef: f.state.task.externalRef,
  };
  const before = JSON.stringify(f.state.task);
  let reads = 0;
  const observe = () =>
    artifactLink.observeApprovedLinearArtifact(
      f.tasks,
      {
        get: () => {
          assert.ok(f.state.approval);
          return f.state.approval;
        },
      },
      {
        list: () => f.state.events,
        publish: (event: Event) => {
          if (f.state.events.some((e) => e.id === event.id)) throw Error('duplicate');
          f.state.events.push(event);
          return event;
        },
      },
      {
        getSecret: (actor, reference) => {
          assert.equal(actor, 'linear:host');
          assert.equal(reference, 'linear:read');
          return 'fixture-artifact-key';
        },
      },
      async (_url, init) => {
        reads++;
        assert.ok(typeof init.body === 'string');
        const payload: unknown = JSON.parse(init.body);
        assert.ok(
          payload &&
            typeof payload === 'object' &&
            'query' in payload &&
            typeof payload.query === 'string',
        );
        assert.ok(payload.query.startsWith('query KernelArtifactStatus('));
        return Response.json({
          data: {
            issue: {
              id: '11111111-1111-4111-8111-111111111111',
              attachments: {
                nodes: [
                  {
                    id: '22222222-2222-4222-8222-222222222222',
                    title: f.input.title,
                    url: 'https://github.com/example/repo/pull/1',
                    issue: { id: '11111111-1111-4111-8111-111111111111' },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      },
      {
        taskId: f.input.taskId,
        title: f.input.title,
        actor: f.input.actor,
        approvalId: 'approval',
      },
      () => 'later',
    );
  const result = await observe();
  assert.equal(result.type, 'linear.artifact.linked');
  assert.deepEqual(await observe(), result);
  assert.equal(reads, 1);
  assert.equal(f.state.calls, 1);
  assert.equal(JSON.stringify(f.state.task), before);
});

test('Linear Artifact observation refuses altered approvals, targets, ambiguous responses and forged receipts', async () => {
  for (const fault of [
    'pending',
    'actor',
    'title',
    'claim',
    'mapping',
    'artifact',
    'missing',
    'duplicate',
    'page',
    'issue',
    'uuid',
    'remote-title',
    'remote-uri',
    'change',
    'receipt',
    'winner',
    'forged',
  ]) {
    const f = fixture();
    f.approve();
    f.state.failure = 'transport';
    await assert.rejects(f.apply);
    const approval = f.state.approval;
    assert.ok(approval);
    if (fault === 'pending') f.state.approval = { request: approval.request, decision: null };
    if (fault === 'claim') f.state.events = [];
    if (fault === 'mapping')
      f.state.task = { ...f.state.task, externalRef: 'https://linear.app/org/issue/ORG-2/other' };
    if (fault === 'artifact') f.state.artifacts = [];
    if (fault === 'forged')
      f.state.events.push({
        id: 'linear-artifact:approval:linked',
        type: 'linear.artifact.linked',
        source: 'other',
        createdAt: 'later',
        payload: {},
      });
    let reads = 0,
      lookups = 0;
    const observe = () =>
      artifactLink.observeApprovedLinearArtifact(
        f.tasks,
        {
          get: () => {
            assert.ok(f.state.approval);
            return f.state.approval;
          },
        },
        {
          list: () => f.state.events,
          publish: (event: Event) => {
            if (fault === 'receipt') throw Error('owned receipt failure');
            f.state.events.push(event);
            if (fault === 'winner') throw Error('owned concurrent winner');
            return event;
          },
        },
        {
          getSecret: () => {
            lookups++;
            return 'fixture-artifact-key';
          },
        },
        async () => {
          reads++;
          if (fault === 'change')
            f.state.task = {
              ...f.state.task,
              externalRef: 'https://linear.app/org/issue/ORG-2/other',
            };
          const attachment = {
            id: fault === 'uuid' ? 'bad' : '22222222-2222-4222-8222-222222222222',
            title: fault === 'remote-title' ? 'changed' : f.input.title,
            url:
              fault === 'remote-uri'
                ? 'https://example.com/other'
                : 'https://github.com/example/repo/pull/1',
            issue: { id: '11111111-1111-4111-8111-111111111111' },
          };
          return Response.json({
            data: {
              issue: {
                id: fault === 'issue' ? 'other' : '11111111-1111-4111-8111-111111111111',
                attachments: {
                  nodes:
                    fault === 'missing'
                      ? []
                      : fault === 'duplicate'
                        ? [attachment, attachment]
                        : [attachment],
                  pageInfo: { hasNextPage: fault === 'page' },
                },
              },
            },
          });
        },
        {
          taskId: f.input.taskId,
          actor: fault === 'actor' ? 'other' : f.input.actor,
          title: fault === 'title' ? 'changed' : f.input.title,
          approvalId: 'approval',
        },
        () => 'later',
      );
    if (fault === 'winner') assert.equal((await observe()).type, 'linear.artifact.linked');
    else await assert.rejects(observe);
    if (['pending', 'actor', 'title', 'claim', 'mapping', 'artifact', 'forged'].includes(fault)) {
      assert.equal(reads, 0);
      assert.equal(lookups, 0);
    }
    assert.equal(f.state.calls, 1);
    if (fault !== 'winner')
      assert.equal(
        f.state.events.filter(
          (e) => e.type === 'linear.artifact.linked' && e.source === 'linear:host',
        ).length,
        0,
      );
  }
});

test('Linear Artifact approval rejects unshared or unrelated output before storing a request', () => {
  for (const uri of [
    'org://sandbox/private',
    'file:///tmp/private',
    'http://example.com/x',
    'https://u:p@example.com/x',
    'https://example.com/x?token=x',
    'https://example.com/x#private',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://localhost./private',
    'https://sub.localhost./private',
  ])
    assert.throws(() => fixture(uri).request());
  const f = fixture();
  f.state.task = { ...f.state.task, outputArtifacts: [] };
  assert.throws(f.request);
  const missing = fixture();
  missing.state.artifacts = [];
  assert.throws(missing.request);
});

test('Linear Artifact apply refuses unapproved or mismatched snapshots before credential lookup', async () => {
  for (const fault of [
    'pending',
    'reject',
    'actor',
    'title',
    'version',
    'uri',
    'artifact',
    'existing',
  ]) {
    const f = fixture();
    f.approve();
    assert.ok(f.state.approval && f.state.approval.decision);
    const decision = f.state.approval.decision;
    if (fault === 'pending') f.state.approval = { ...f.state.approval, decision: null };
    if (fault === 'reject')
      f.state.approval = { ...f.state.approval, decision: { ...decision, decision: 'reject' } };
    if (fault === 'version')
      f.state.task = {
        ...changeTask(f.state.task, { title: 'new' }, 'later'),
        externalRef: f.state.task.externalRef,
      };
    if (fault === 'uri')
      f.state.artifacts = [
        { id: 'published', uri: 'https://github.com/example/repo/pull/2', createdAt: 'before' },
      ];
    if (fault === 'artifact') f.state.task = { ...f.state.task, outputArtifacts: [] };
    if (fault === 'existing')
      f.state.events.push({
        id: 'linear-artifact:approval',
        type: 'linear.artifact.claimed',
        source: 'linear:host',
        payload: {},
        createdAt: 'same',
      });
    await assert.rejects(() =>
      f.apply(fault === 'actor' ? { actor: 'other' } : fault === 'title' ? { title: 'other' } : {}),
    );
    assert.equal(f.state.lookups, 0);
    assert.equal(f.state.calls, 0);
  }
});

test('Linear Artifact apply preserves claim and uncertainty through credential, transport and persistence faults', async () => {
  for (const fault of ['credential', 'change', 'claim', 'transport', 'receipt', 'terminal']) {
    const f = fixture();
    f.approve();
    f.state.failure = fault;
    await assert.rejects(
      () => f.apply(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /fixture-artifact-key|Reviewed artifact/);
        return true;
      },
    );
    const called = ['transport', 'receipt', 'terminal'].includes(fault);
    assert.equal(f.state.calls, called ? 1 : 0);
    if (called) {
      assert.equal(f.state.events[0]?.type, 'linear.artifact.claimed');
      assert.equal(
        f.state.events.at(-1)?.type,
        fault === 'terminal' ? 'linear.artifact.claimed' : 'linear.artifact.unconfirmed',
      );
      f.state.failure = '';
      await assert.rejects(() => f.apply(), /claimed/);
      assert.equal(f.state.calls, 1);
    } else assert.equal(f.state.events.length, 0);
  }
});

test('Linear Artifact apply validates returned Issue, URI, title and UUID without leaking credential reflections', async () => {
  const valid = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Reviewed artifact',
    url: 'https://github.com/example/repo/pull/1',
    issue: { id: '11111111-1111-4111-8111-111111111111' },
  };
  for (const attachment of [
    null,
    { ...valid, id: 'bad' },
    { ...valid, title: 'other' },
    { ...valid, url: 'https://github.com/example/repo/pull/2' },
    { ...valid, issue: { id: 'other' } },
    { ...valid, title: 'fixture-artifact-key' },
  ]) {
    const f = fixture();
    f.approve();
    f.state.response = { data: { attachmentCreate: { success: true, attachment } } };
    await assert.rejects(() => f.apply());
    assert.deepEqual(
      f.state.events.map((e) => e.type),
      ['linear.artifact.claimed', 'linear.artifact.unconfirmed'],
    );
    assert.equal(f.state.calls, 1);
  }
  const reflected = fixture('https://github.com/example/repo/fixture-artifact-key');
  reflected.approve();
  await assert.rejects(() => reflected.apply(), /Invalid Linear input/);
  assert.equal(reflected.state.calls, 0);
  assert.equal(reflected.state.events.length, 0);
  const f = fixture();
  f.approve();
  const original = JSON.stringify(f.state.task);
  const linked = await f.apply();
  assert.equal(linked.type, 'linear.artifact.linked');
  assert.equal(JSON.stringify(f.state.task), original);
  assert.doesNotMatch(JSON.stringify(f.state.events), /Reviewed artifact|fixture-artifact-key/);
});

test('Linear Artifact Audit binds linked URI to the approved digest and rejects forged originals', async () => {
  const f = fixture();
  f.approve();
  await f.apply();
  assert.ok(f.state.approval);
  const approval = f.state.approval;
  const originals = f.state.events.slice(),
    claim = originals[0],
    linked = originals[1];
  assert.ok(claim && linked);
  const audit = buildAudit([approval], [], buildLinearAudit(originals, [approval]));
  assert.deepEqual(
    audit.map((e) => e.result),
    ['pending', 'approved', 'started', 'succeeded'],
  );
  assert.equal(audit.at(-1)?.outputRef, 'https://github.com/example/repo/pull/1');
  assert.throws(() => buildLinearAudit(originals, []), /Approval/);
  assert.throws(() => buildLinearAudit([linked], [approval]), /claim/);
  for (const payload of [
    { ...linked.payload, actorId: 'other' },
    { ...linked.payload, artifactUri: 'https://github.com/example/repo/pull/2' },
    { ...linked.payload, attachmentId: 'bad' },
  ])
    assert.throws(() => buildLinearAudit([claim, { ...linked, payload }], [approval]));
  assert.doesNotMatch(JSON.stringify(audit), /Reviewed artifact|fixture-artifact-key/);
});

test('Linear Artifact rejects URI-encoded credentials before HTTP or immutable claim', async () => {
  const credential = 'fixture-quote-"-slash-/-key';
  const f = fixture('https://github.com/example/repo/' + encodeURIComponent(credential));
  f.state.credential = credential;
  f.approve();
  await assert.rejects(() => f.apply(), /Invalid Linear input/);
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.events.length, 0);
});
