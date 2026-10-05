import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { importGithubWebhook } from '../src/events/github-webhook.js';
import type { Event } from '../src/events/domain.js';
const secret = 'fixture-webhook-key-with-at-least-32-characters';
const raw = {
  action: 'edited',
  repository: { id: 42, full_name: 'fixture/repo', private: false },
  issue: {
    id: 7,
    number: 1,
    title: 'Local task',
    body: null,
    html_url: 'https://github.com/fixture/repo/issues/1',
    updated_at: '2026-10-06T00:00:00Z',
  },
};
const body = JSON.stringify(raw);
const input = {
  repository: 'fixture/repo',
  body,
  signature: 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
  delivery: '11111111-1111-4111-8111-111111111111',
};
test('signed Issue webhook validates bytes and scope before publishing and deduplicates changed delivery headers', () => {
  const stored: Event[] = [];
  let lookups = 0,
    writes = 0;
  const secrets = {
    getSecret(actor: string, ref: string) {
      lookups++;
      assert.equal(actor, 'github:host');
      assert.equal(ref, 'github:webhook');
      return secret;
    },
  };
  const bus = {
    list: () => stored,
    publishOnce(event: Event) {
      writes++;
      stored.push(event);
      return event;
    },
  };
  const first = importGithubWebhook(bus, secrets, input);
  assert.equal(first.type, 'github.issues.edited');
  assert.equal(first.source, 'github:fixture/repo');
  assert.equal(first.createdAt, '2026-10-06T00:00:00.000Z');
  assert.deepEqual(first.payload.webhook, raw);
  assert.equal(first.payload.delivery, input.delivery);
  assert.deepEqual(
    importGithubWebhook(bus, secrets, {
      ...input,
      delivery: '22222222-2222-4222-8222-222222222222',
    }),
    first,
  );
  assert.equal(writes, 1);
  assert.equal(stored.length, 1);
  for (const bad of [
    { ...input, signature: 'sha256=' + '0'.repeat(64) },
    { ...input, body: body + ' ' },
    { ...input, signature: 'sha1=abc' },
    { ...input, delivery: '../outside' },
    { ...input, body: 'x'.repeat(65537) },
    { ...input, repository: '../repo' },
  ])
    assert.throws(() => importGithubWebhook(bus, secrets, bad));
  const afterLookups = lookups;
  assert.throws(() => importGithubWebhook(bus, secrets, { ...input, delivery: '' }));
  assert.equal(lookups, afterLookups);
  for (const value of [
    { ...raw, repository: { ...raw.repository, full_name: 'other/repo' } },
    { ...raw, repository: { ...raw.repository, private: true } },
    { ...raw, action: 'deleted' },
    { ...raw, issue: { ...raw.issue, html_url: 'https://github.com/fixture/repo/issues/2' } },
    { ...raw, issue: { ...raw.issue, updated_at: '2026-02-30T00:00:00Z' } },
    { ...raw, issue: { ...raw.issue, pull_request: {} } },
    { ...raw, issue: { ...raw.issue, body: secret } },
    [],
  ]) {
    const text = JSON.stringify(value);
    assert.throws(() =>
      importGithubWebhook(bus, secrets, {
        ...input,
        body: text,
        signature: 'sha256=' + createHmac('sha256', secret).update(text).digest('hex'),
      }),
    );
  }
  assert.equal(writes, 1);
  const escapedSecret = JSON.stringify({ ...raw, issue: { ...raw.issue, body: secret } }).replace(
    secret,
    Array.from(secret, (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
  );
  assert.ok(!escapedSecret.includes(secret));
  assert.throws(
    () =>
      importGithubWebhook(bus, secrets, {
        ...input,
        body: escapedSecret,
        signature: 'sha256=' + createHmac('sha256', secret).update(escapedSecret).digest('hex'),
      }),
    /credential reflection/,
  );
  assert.throws(
    () =>
      importGithubWebhook(
        bus,
        {
          getSecret() {
            throw Error(secret);
          },
        },
        input,
      ),
    (error: unknown) =>
      error instanceof Error && error.message === 'GitHub webhook secret unavailable',
  );
  assert.throws(
    () =>
      importGithubWebhook(
        {
          list: () => [],
          publishOnce() {
            throw Error('storage');
          },
        },
        secrets,
        input,
      ),
    /storage/,
  );
});
