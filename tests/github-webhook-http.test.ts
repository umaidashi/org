import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { receiveGithubWebhook } from '../src/events/github-webhook-http.js';
import { importGithubWebhook } from '../src/events/github-webhook.js';
import type { Event } from '../src/events/domain.js';
const secret = 'synthetic-webhook-private-value';
const value = {
  action: 'opened',
  repository: { id: 42, full_name: 'fixture/repo', private: false },
  issue: {
    id: 7,
    number: 1,
    title: 'Work',
    body: null,
    html_url: 'https://github.com/fixture/repo/issues/1',
    updated_at: '2026-10-07T00:00:00Z',
  },
};
const body = JSON.stringify(value);
const headers = {
  'content-type': 'application/json',
  'x-github-event': 'issues',
  'x-github-delivery': '11111111-1111-4111-8111-111111111111',
  'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
};
test('HTTP adapter delegates verified scoped Issue delivery once and never returns payload or credential', async () => {
  const stored: Event[] = [];
  const receive = (input: Parameters<typeof importGithubWebhook>[2]) =>
    importGithubWebhook(
      {
        list: () => stored,
        publishOnce: (event) => {
          stored.push(event);
          return event;
        },
      },
      { getSecret: () => secret },
      input,
    );
  for (let index = 0; index < 2; index++) {
    const response = await receiveGithubWebhook(
      new Request('http://localhost/hooks/github', { method: 'POST', headers, body }),
      'fixture/repo',
      receive,
      () => true,
    );
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { id: stored[0]?.id });
  }
  assert.equal(stored.length, 1);
  for (const request of [
    new Request('http://localhost/other', { method: 'POST', headers, body }),
    new Request('http://localhost/hooks/github'),
    new Request('http://localhost/hooks/github', {
      method: 'POST',
      headers: { ...headers, 'x-github-event': 'push' },
      body,
    }),
    new Request('http://localhost/hooks/github', {
      method: 'POST',
      headers: { ...headers, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
      body,
    }),
    new Request('http://localhost/hooks/github', {
      method: 'POST',
      headers,
      body: 'x'.repeat(65537),
    }),
  ]) {
    const response = await receiveGithubWebhook(request, 'fixture/repo', receive, () => true);
    assert.ok(response.status >= 400);
    assert.equal(await response.text(), 'Webhook rejected');
  }
  assert.equal(stored.length, 1);
  const hidden = await receiveGithubWebhook(
    new Request('http://localhost/hooks/github', { method: 'POST', headers, body }),
    'fixture/repo',
    () => {
      throw new Error(secret);
    },
    () => true,
  );
  assert.equal(hidden.status, 400);
  assert.equal(await hidden.text(), 'Webhook rejected');
  const closing = await receiveGithubWebhook(
    new Request('http://localhost/hooks/github', { method: 'POST', headers, body }),
    'fixture/repo',
    () => assert.fail('must not publish'),
    () => false,
  );
  assert.equal(closing.status, 503);
  let checks = 0;
  const draining = await receiveGithubWebhook(
    new Request('http://localhost/hooks/github', { method: 'POST', headers, body }),
    'fixture/repo',
    () => assert.fail('must not publish after body read'),
    () => ++checks === 1,
  );
  assert.equal(draining.status, 503);
  assert.equal(checks, 2);
});

test('HTTP signature validation rejects BOM and invalid UTF8 byte normalization despite valid decoded signatures', async () => {
  const encoded = new TextEncoder().encode(body);
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]);
  const authenticated = (input: Parameters<typeof importGithubWebhook>[2]) =>
    importGithubWebhook(
      { list: () => [], publishOnce: (event) => event },
      { getSecret: () => secret },
      input,
    );
  const response = await receiveGithubWebhook(
    new Request('http://localhost/hooks/github', { method: 'POST', headers, body: bom }),
    'fixture/repo',
    authenticated,
    () => true,
  );
  assert.equal(response.status, 400);
  const replacementBody = JSON.stringify({
    ...value,
    issue: { ...value.issue, title: 'Work\ufffd' },
  });
  const bytes = Buffer.from(replacementBody);
  const replacement = bytes.indexOf(Buffer.from('\ufffd'));
  assert.ok(replacement >= 0);
  const malformed = Buffer.concat([
    bytes.subarray(0, replacement),
    Buffer.from([0xff]),
    bytes.subarray(replacement + 3),
  ]);
  const malformedHeaders = {
    ...headers,
    'x-hub-signature-256':
      'sha256=' + createHmac('sha256', secret).update(replacementBody).digest('hex'),
  };
  const rejected = await receiveGithubWebhook(
    new Request('http://localhost/hooks/github', {
      method: 'POST',
      headers: malformedHeaders,
      body: malformed,
    }),
    'fixture/repo',
    authenticated,
    () => true,
  );
  assert.equal(rejected.status, 400);
});
