import { boundedJson } from '../runtime/http.js';
import type { SecretStore } from '../secrets/port.js';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateLinearIssueId(id: string): string {
  if (uuid.test(id)) return id.toLowerCase();
  if (/^[A-Z][A-Z0-9]{0,31}-[1-9][0-9]{0,15}$/.test(id)) return id;
  throw new Error('Invalid Linear Issue ID');
}
export async function readLinearIssue(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  issueId: string,
): Promise<
  Readonly<{
    provider: 'linear';
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    url: string;
  }>
> {
  const id = validateLinearIssueId(issueId);
  let credential: string;
  try {
    credential = secrets.getSecret('linear:host', 'linear:read');
  } catch {
    throw new Error('Linear credential unavailable');
  }
  if (!/^[\x21-\x7e]{1,4096}$/.test(credential)) throw new Error('Linear credential unavailable');
  let response: Response;
  try {
    response = await request('https://api.linear.app/graphql', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: credential, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'query KernelIssue($id: String!) { issue(id: $id) { id identifier title description url } }',
        variables: { id },
      }),
    });
  } catch {
    throw new Error('Linear request failed');
  }
  if (response.status !== 200) {
    const error = new Error(`Linear request failed: ${response.status}`);
    try {
      await response.body?.cancel();
    } catch {
      throw error;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = await boundedJson(response, 262144);
  } catch {
    throw new Error('Invalid Linear response');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ('errors' in value && (!Array.isArray(value.errors) || value.errors.length !== 0)) ||
    !('data' in value) ||
    value.data === null ||
    typeof value.data !== 'object' ||
    !('issue' in value.data)
  )
    throw new Error('Invalid or failed Linear response');
  const issue = value.data.issue;
  if (
    issue === null ||
    typeof issue !== 'object' ||
    Array.isArray(issue) ||
    !('id' in issue) ||
    typeof issue.id !== 'string' ||
    !uuid.test(issue.id) ||
    !('identifier' in issue) ||
    typeof issue.identifier !== 'string' ||
    !('title' in issue) ||
    typeof issue.title !== 'string' ||
    !issue.title.trim() ||
    !('description' in issue) ||
    (issue.description !== null && typeof issue.description !== 'string') ||
    !('url' in issue) ||
    typeof issue.url !== 'string'
  )
    throw new Error('Invalid Linear Issue');
  if (
    (uuid.test(id) ? issue.id.toLowerCase() !== id : issue.identifier !== id) ||
    validateLinearIssueId(issue.identifier) !== issue.identifier
  )
    throw new Error('Linear Issue identity mismatch');
  let url: URL;
  try {
    url = new URL(issue.url);
  } catch {
    throw new Error('Invalid Linear Issue URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'linear.app' ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.includes('/issue/') ||
    url.pathname.split('/issue/')[1]?.split('/')[0] !== issue.identifier
  )
    throw new Error('Invalid Linear Issue URL');
  const result = {
    provider: 'linear' as const,
    id: issue.id.toLowerCase(),
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: issue.url,
  };
  if (JSON.stringify(result).includes(credential)) throw new Error('Invalid Linear Issue');
  return result;
}
