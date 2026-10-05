import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { importGithubEvents } from '../src/events/github.js';
import type { Event } from '../src/events/domain.js';

const raw = {
  id: '9007199254740993',
  type: 'PullRequestEvent',
  public: true,
  repo: { id: 42, name: 'Fixture/Repo' },
  actor: { login: 'original' },
  payload: { action: 'opened', number: 7 },
  created_at: '2026-10-05T00:00:00Z',
};
test('GitHub import validates public responses and reuses first originals across mutable metadata', async () => {
  const stored = new Map<string, Event>();
  const bus = {
    list: () => [...stored.values()],
    publishOnce: (event: Event) => {
      const old = stored.get(event.id);
      if (old) assert.deepEqual(event, old);
      stored.set(event.id, event);
      return event;
    },
  };
  let calls = 0;
  const request = async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/fixture/repo/events?per_page=100&page=1');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json([calls === 1 ? raw : { ...raw, actor: { login: 'changed' } }]);
  };
  const first = await importGithubEvents(bus, request, 'Fixture/Repo');
  assert.equal(first.length, 1);
  assert.equal(first[0]?.id, 'github:42:9007199254740993');
  assert.equal(first[0]?.type, 'github.pull_request.opened');
  assert.equal(first[0]?.source, 'github:fixture/repo');
  assert.deepEqual(first[0]?.payload, raw);
  assert.deepEqual(await importGithubEvents(bus, request, 'fixture/repo'), first);
  assert.equal(stored.size, 1);
  for (const input of [
    [{ ...raw, public: false }],
    [{ ...raw, repo: { ...raw.repo, name: 'other/repo' } }],
    [{ ...raw, created_at: '2026-02-31T00:00:00Z' }],
    [{ ...raw, id: 7 }],
    [{ ...raw, payload: [] }],
    [{ ...raw, payload: { action: 'bad.action' } }],
    { error: 'invalid' },
    [raw, { ...raw, public: false }],
  ]) {
    let writes = 0;
    await assert.rejects(
      importGithubEvents(
        {
          list: () => [],
          publishOnce: (event) => {
            writes++;
            return event;
          },
        },
        async () => Response.json(input),
        'fixture/repo',
      ),
    );
    assert.equal(writes, 0);
  }
  await assert.rejects(
    importGithubEvents(
      bus,
      async () => Response.json([{ ...raw, created_at: '2026-10-05T00:00:01Z' }]),
      'fixture/repo',
    ),
  );
  await assert.rejects(
    importGithubEvents(bus, async () => new Response('denied', { status: 403 }), 'fixture/repo'),
  );
  await assert.rejects(
    importGithubEvents(
      bus,
      async () => {
        throw new Error('network failed');
      },
      'fixture/repo',
    ),
    /network failed/,
  );
  await assert.rejects(
    importGithubEvents(
      bus,
      async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
      'fixture/repo',
    ),
    /size limit/,
  );
  await assert.rejects(importGithubEvents(bus, request, '../repo'), /OWNER\/REPO/);
  assert.equal(calls, 2);
});

test('GitHub import caps pagination and validates later pages before any publication', async () => {
  let writes = 0;
  const bus = {
    list: () => [],
    publishOnce: (event: Event) => {
      writes++;
      return event;
    },
  };
  const pages: string[] = [];
  const result = await importGithubEvents(
    bus,
    async (url) => {
      pages.push(url);
      return Response.json(
        Array.from({ length: 100 }, (_, index) => ({
          ...raw,
          id: String(pages.length * 100 + index),
        })),
      );
    },
    'fixture/repo',
  );
  assert.equal(pages.length, 3);
  assert.equal(result.length, 300);
  assert.equal(writes, 300);
  assert.ok(pages.every((url, index) => url.endsWith('page=' + (index + 1))));
  writes = 0;
  let page = 0;
  await assert.rejects(
    importGithubEvents(
      bus,
      async () => {
        page++;
        return Response.json(
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({ ...raw, id: String(index) }))
            : [{ ...raw, public: false }],
        );
      },
      'fixture/repo',
    ),
  );
  assert.equal(writes, 0);
});

test('GitHub repository validation accepts dot repositories while denying path traversal', async () => {
  let called = 0;
  const bus = { list: () => [], publishOnce: (event: Event) => event };
  const request = async (url: string) => {
    called++;
    assert.equal(url, 'https://api.github.com/repos/github/.github/events?per_page=100&page=1');
    return Response.json([]);
  };
  assert.deepEqual(await importGithubEvents(bus, request, 'github/.github'), []);
  for (const repo of [
    'github/.',
    'github/..',
    'github/../other',
    'github/%2e%2e',
    'github/repo?query',
    'github/repo#hash',
  ])
    await assert.rejects(importGithubEvents(bus, request, repo), /OWNER\/REPO/);
  assert.equal(called, 1);
});
