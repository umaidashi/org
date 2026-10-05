import { boundedJson } from '../runtime/http.js';
import { createEvent, jsonObject } from './domain.js';
import type { Event } from './domain.js';
import type { EventBus } from './port.js';

export function validateGithubRepository(repository: string): string {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(repository) ||
    ['.', '..'].includes(repository.split('/')[1] ?? '')
  )
    throw new Error('Expected GitHub OWNER/REPO');
  return repository.toLowerCase();
}
function decodeGithubEvent(value: unknown, repository: string): Event {
  const raw = jsonObject(value);
  const repo = jsonObject(raw.repo);
  const payload = jsonObject(raw.payload);
  if (
    raw.public !== true ||
    typeof raw.id !== 'string' ||
    !/^[0-9]+$/.test(raw.id) ||
    typeof raw.type !== 'string' ||
    !/^[A-Z][a-zA-Z0-9]*Event$/.test(raw.type) ||
    typeof repo.id !== 'number' ||
    !Number.isSafeInteger(repo.id) ||
    repo.id <= 0 ||
    typeof repo.name !== 'string' ||
    repo.name.toLowerCase() !== repository ||
    typeof raw.created_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw.created_at)
  )
    throw new Error('Invalid public GitHub Event');
  const timestamp = Date.parse(raw.created_at);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw.created_at.replace('Z', '.000Z')
  )
    throw new Error('Invalid GitHub Event timestamp');
  if (
    payload.action !== undefined &&
    (typeof payload.action !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(payload.action))
  )
    throw new Error('Invalid GitHub Event action');
  const name = raw.type
    .slice(0, -5)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return createEvent(
    {
      type: `github.${name}${payload.action === undefined ? '' : '.' + payload.action}`,
      source: `github:${repository}`,
      payload: raw,
    },
    { id: `github:${repo.id}:${raw.id}`, createdAt: new Date(timestamp).toISOString() },
  );
}
export async function importGithubEvents(
  bus: Pick<EventBus, 'list' | 'publishOnce'>,
  request: (url: string, init: RequestInit) => Promise<Response>,
  repository: string,
): Promise<readonly Event[]> {
  const repo = validateGithubRepository(repository);
  const incoming: Event[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await request(
      `https://api.github.com/repos/${repo}/events?per_page=100&page=${page}`,
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'org-kernel',
          'X-GitHub-Api-Version': '2026-03-10',
        },
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`GitHub Event request failed: ${response.status}`);
    }
    const body = await boundedJson(response, 4 * 1024 * 1024);
    if (!Array.isArray(body) || body.length > 100) throw new Error('Invalid GitHub Event page');
    incoming.push(...body.map((value: unknown) => decodeGithubEvent(value, repo)));
    if (body.length < 100) break;
  }
  const stored = new Map(bus.list().map((event) => [event.id, event]));
  const planned = incoming
    .reverse()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((event) => {
      const old = stored.get(event.id);
      if (
        old &&
        (old.type !== event.type ||
          old.source !== event.source ||
          old.createdAt !== event.createdAt)
      )
        throw new Error('GitHub Event idempotency conflict');
      const original = old ?? event;
      stored.set(event.id, original);
      return original;
    });
  return planned.map((event) => bus.publishOnce(event));
}
