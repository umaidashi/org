import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { readNotionDocument, validateNotionPageId } from '../src/knowledge/notion.js';
const page = '3ee8a402-0cb6-81d1-8daa-cc1e0016d596';
const body = {
  object: 'page_markdown',
  id: page,
  markdown: '# 日本語\n供給された構想',
  truncated: false,
  unknown_block_ids: [],
};
const secrets = {
  getSecret: (actor: string, reference: string) => {
    assert.equal(actor, 'knowledge:host');
    assert.equal(reference, 'notion:read');
    return 'fixture-credential';
  },
};
test('Notion native Markdown uses canonical page GET fixed host bounded timeout and scoped secret', async () => {
  assert.equal(validateNotionPageId(page.replaceAll('-', '').toUpperCase()), page);
  const doc = await readNotionDocument(
    async (url, init) => {
      assert.equal(url, `https://api.notion.com/v1/pages/${page}/markdown`);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-credential');
      assert.equal(new Headers(init.headers).get('Notion-Version'), '2026-03-11');
      return Response.json(body);
    },
    secrets,
    page,
  );
  assert.equal(doc.provider, 'notion');
  assert.equal(doc.id, page);
  assert.equal(doc.url, 'https://www.notion.so/' + page.replaceAll('-', ''));
  assert.equal(doc.content, body.markdown);
  assert.match(doc.contentHash, /^[a-f0-9]{64}$/);
  const again = await readNotionDocument(async () => Response.json(body), secrets, page);
  assert.deepEqual(again, doc);
});
test('Notion rejects invalid IDs before credential lookup and HTTP, and hides secret lookup failure', async () => {
  for (const id of ['https://evil.test', page + '?x=1', 'x', '3-ee8a4020cb681d18daacc1e0016d596'])
    await assert.rejects(
      () =>
        readNotionDocument(
          async () => {
            throw Error('HTTP should not run');
          },
          {
            getSecret: () => {
              throw Error('lookup should not run');
            },
          },
          id,
        ),
      /Invalid Notion page ID/,
    );
  await assert.rejects(
    () =>
      readNotionDocument(
        async () => {
          throw Error('HTTP should not run');
        },
        {
          getSecret: () => {
            throw Error('fixture-credential');
          },
        },
        page,
      ),
    (error) => error instanceof Error && !error.message.includes('fixture-credential'),
  );
});
test('Notion rejects mismatched partial malformed oversized and reflected-credential responses without leaking response', async () => {
  for (const value of [
    { ...body, id: '00000000-0000-0000-0000-000000000000' },
    { ...body, truncated: true },
    { ...body, unknown_block_ids: [page] },
    { ...body, markdown: 'fixture-credential' },
    { ...body, markdown: 'x'.repeat(262145) },
    { ...body, object: 'block' },
    { id: page },
    [],
  ])
    await assert.rejects(
      () => readNotionDocument(async () => Response.json(value), secrets, page),
      (error) => error instanceof Error && !error.message.includes('fixture-credential'),
    );
  await assert.rejects(
    () =>
      readNotionDocument(
        async () => new Response('private-body fixture-credential', { status: 403 }),
        secrets,
        page,
      ),
    /Notion request failed: 403/,
  );
  await assert.rejects(
    () =>
      readNotionDocument(
        async () => {
          throw Error('fixture-credential');
        },
        secrets,
        page,
      ),
    (error) => error instanceof Error && !error.message.includes('fixture-credential'),
  );
  await assert.rejects(
    () =>
      readNotionDocument(async () => new Response('bad-json fixture-credential'), secrets, page),
    (error) => error instanceof Error && !error.message.includes('fixture-credential'),
  );
});
