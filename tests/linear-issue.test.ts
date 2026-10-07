import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readLinearIssue, listLinearIssues } from '../src/linear/read.js';
const id = '11111111-1111-4111-8111-111111111111';
const issue = {
  id,
  identifier: 'ORG-1',
  title: '日本語',
  description: null,
  url: 'https://linear.app/example/issue/ORG-1/example',
};
const secrets = {
  getSecret: (actor: string, ref: string) => {
    assert.equal(actor, 'linear:host');
    assert.equal(ref, 'linear:read');
    return 'fixture-linear-key';
  },
};
test('Linear issue reader uses fixed query and personal-key authorization without creating issues', async () => {
  const result = await readLinearIssue(
    async (url, init) => {
      assert.equal(url, 'https://api.linear.app/graphql');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal);
      assert.equal(new Headers(init.headers).get('Authorization'), 'fixture-linear-key');
      assert.equal(typeof init.body, 'string');
      assert.ok(typeof init.body === 'string');
      const body: unknown = JSON.parse(init.body);
      assert.ok(
        body !== null &&
          typeof body === 'object' &&
          'query' in body &&
          typeof body.query === 'string' &&
          'variables' in body,
      );
      assert.match(body.query, /query /);
      assert.doesNotMatch(body.query, /mutation/);
      assert.deepEqual(body.variables, { id: 'ORG-1' });
      return Response.json({ data: { issue } });
    },
    secrets,
    'ORG-1',
  );
  assert.deepEqual(result, { provider: 'linear', ...issue });
});
test('Linear reader rejects malformed inputs before secrets and sanitizes partial errors or invalid identities', async () => {
  let touched = false;
  await assert.rejects(() =>
    readLinearIssue(
      async () => {
        touched = true;
        throw Error('unexpected');
      },
      {
        getSecret: () => {
          touched = true;
          return 'x';
        },
      },
      'ORG-1" } mutation {',
    ),
  );
  assert.equal(touched, false);
  for (const body of [
    { data: { issue }, errors: [{ message: 'fixture-linear-key' }] },
    { data: { issue: { ...issue, identifier: 'OTHER-1' } } },
    { data: { issue: { ...issue, url: 'https://evil.test' } } },
    { data: { issue: { ...issue, url: 'https://linear.app/example/issue/OTHER-9/example' } } },
    { data: { issue: { ...issue, title: 'fixture-linear-key' } } },
    { data: { issue: null } },
  ])
    await assert.rejects(
      () => readLinearIssue(async () => Response.json(body), secrets, 'ORG-1'),
      (e) => e instanceof Error && !e.message.includes('fixture-linear-key'),
    );
  await assert.rejects(
    () =>
      readLinearIssue(
        async () => {
          throw Error('fixture-linear-key');
        },
        secrets,
        id,
      ),
    (e) => e instanceof Error && !e.message.includes('fixture-linear-key'),
  );
  await assert.rejects(
    () =>
      readLinearIssue(async () => new Response('fixture-linear-key', { status: 403 }), secrets, id),
    /403/,
  );
});

test('Linear shared query rejects escaped credentials in get/list values, keys and cursors while preserving unrelated quoted text', async () => {
  for (const credential of [
    'fixture-quote-"-key',
    'fixture-backslash-\\-key',
    'fixture-both-"-\\-key',
  ]) {
    const store = { getSecret: () => credential };
    for (const data of [
      { issue: { ...issue, title: 'prefix ' + credential + ' suffix' } },
      { issue: { ...issue, description: credential } },
      { issue, metadata: { [credential]: 'value' } },
    ])
      await assert.rejects(
        readLinearIssue(async () => Response.json({ data }), store, 'ORG-1'),
        (error) => error instanceof Error && error.message === 'Invalid Linear response',
      );
    for (const data of [
      {
        issues: {
          nodes: [{ ...issue, title: credential }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
      { issues: { nodes: [issue], pageInfo: { hasNextPage: true, endCursor: credential } } },
      {
        issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } },
        metadata: { [credential]: 'value' },
      },
    ])
      await assert.rejects(
        listLinearIssues(async () => Response.json({ data }), store, { team: 'ORG', limit: 1 }),
        (error) => error instanceof Error && error.message === 'Invalid Linear response',
      );
    const quoted = { ...issue, title: 'Keep "quoted" text', description: 'Keep \\ path' };
    assert.deepEqual(
      await readLinearIssue(async () => Response.json({ data: { issue: quoted } }), store, 'ORG-1'),
      { provider: 'linear', ...quoted },
    );
  }
});

test('Linear reader rejects URI-encoded credential reflections before returning external Issue data', async () => {
  const credential = 'fixture-quote-"-slash-/-key';
  for (const encoded of [
    encodeURI(credential),
    encodeURIComponent(credential),
    encodeURIComponent(credential).replace(/%[a-f0-9]{2}/gi, (m) => m.toLowerCase()),
  ]) {
    await assert.rejects(
      () =>
        readLinearIssue(
          async () =>
            Response.json({
              data: {
                issue: {
                  id: '11111111-1111-4111-8111-111111111111',
                  identifier: 'ORG-1',
                  title: encoded,
                  description: null,
                  url: 'https://linear.app/org/issue/ORG-1/existing',
                },
              },
            }),
          { getSecret: () => credential },
          'ORG-1',
        ),
      /Invalid Linear response/,
    );
  }
});
