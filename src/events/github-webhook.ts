import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SecretStore } from '../secrets/port.js';
import { createEvent, jsonObject, type Event } from './domain.js';
import type { EventBus } from './port.js';
import { validateGithubRepository } from './github.js';

export interface GithubWebhookInput {
  readonly repository: string;
  readonly body: string;
  readonly signature: string;
  readonly delivery: string;
}
export function validateGithubWebhookInput(input: GithubWebhookInput): string {
  const repository = validateGithubRepository(input.repository);
  if (
    !/^sha256=[a-f0-9]{64}$/.test(input.signature) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.delivery) ||
    !input.body.length ||
    Buffer.byteLength(input.body) > 65536
  )
    throw new Error('Invalid GitHub webhook input');
  return repository;
}
export function importGithubWebhook(
  bus: Pick<EventBus, 'list' | 'publishOnce'>,
  secrets: SecretStore,
  input: GithubWebhookInput,
): Event {
  const repository = validateGithubWebhookInput(input);
  let secret: string;
  try {
    secret = secrets.getSecret('github:host', 'github:webhook');
    if (!secret.length || Buffer.byteLength(secret) > 65536 || secret.includes('\0'))
      throw new Error('Invalid secret');
  } catch {
    throw new Error('GitHub webhook secret unavailable');
  }
  const actual = createHmac('sha256', secret).update(input.body, 'utf8').digest();
  if (!timingSafeEqual(actual, Buffer.from(input.signature.slice(7), 'hex')))
    throw new Error('GitHub webhook signature mismatch');
  let raw;
  try {
    raw = jsonObject(JSON.parse(input.body));
  } catch {
    throw new Error('Invalid GitHub webhook JSON');
  }
  if (JSON.stringify(raw).includes(JSON.stringify(secret).slice(1, -1)))
    throw new Error('GitHub webhook credential reflection');
  const repo = jsonObject(raw.repository),
    issue = jsonObject(raw.issue);
  const action = raw.action;
  if (
    typeof action !== 'string' ||
    !['opened', 'edited', 'closed', 'reopened'].includes(action) ||
    repo.private !== false ||
    typeof repo.id !== 'number' ||
    !Number.isSafeInteger(repo.id) ||
    repo.id <= 0 ||
    typeof repo.full_name !== 'string' ||
    repo.full_name.toLowerCase() !== repository ||
    typeof issue.id !== 'number' ||
    !Number.isSafeInteger(issue.id) ||
    issue.id <= 0 ||
    typeof issue.number !== 'number' ||
    !Number.isSafeInteger(issue.number) ||
    issue.number <= 0 ||
    typeof issue.title !== 'string' ||
    !issue.title.trim() ||
    (issue.body !== null && typeof issue.body !== 'string') ||
    Object.hasOwn(issue, 'pull_request') ||
    typeof issue.html_url !== 'string' ||
    issue.html_url.toLowerCase() !== `https://github.com/${repository}/issues/${issue.number}` ||
    typeof issue.updated_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(issue.updated_at)
  )
    throw new Error('Invalid scoped GitHub Issue webhook');
  const time = Date.parse(issue.updated_at);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== issue.updated_at.replace('Z', '.000Z')
  )
    throw new Error('Invalid GitHub webhook timestamp');
  const digest = createHash('sha256').update(input.body, 'utf8').digest('hex');
  const event = createEvent(
    {
      type: `github.issues.${action}`,
      source: `github:${repository}`,
      payload: { webhook: raw, delivery: input.delivery, bodySha256: digest },
    },
    { id: `github:webhook:${repo.id}:${digest}`, createdAt: new Date(time).toISOString() },
  );
  // ponytail: local journal scan; add a public receipt lookup when event volume matters.
  const original = bus.list().find((candidate) => candidate.id === event.id);
  if (original) {
    if (
      original.type !== event.type ||
      original.source !== event.source ||
      original.createdAt !== event.createdAt ||
      original.payload.bodySha256 !== digest ||
      !isDeepStrictEqual(original.payload.webhook, raw)
    )
      throw new Error('GitHub webhook idempotency conflict');
    return original;
  }
  return bus.publishOnce(event);
}
