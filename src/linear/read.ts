import { boundedJson } from '../runtime/http.js';
import type { SecretStore } from '../secrets/port.js';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateLinearIssueId(id: string): string {
  if (uuid.test(id)) return id.toLowerCase();
  if (/^[A-Z][A-Z0-9]{0,31}-[1-9][0-9]{0,15}$/.test(id)) return id;
  throw new Error('Invalid Linear Issue ID');
}
export interface LinearIssue {
  readonly provider: 'linear';
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
}
function containsCredential(value: object, credential: string): boolean {
  const normalize = (text: string) =>
    text.replace(/%[a-f0-9]{2}/gi, (escape) => escape.toUpperCase());
  const data = normalize(JSON.stringify(value));
  return [credential, encodeURI(credential), encodeURIComponent(credential)].some((encoded) =>
    data.includes(normalize(JSON.stringify(encoded).slice(1, -1))),
  );
}
export async function queryLinear(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  query: string,
  variables: Readonly<Record<string, string | number | null>>,
  access:
    | { readonly reference: 'linear:read' }
    | { readonly reference: 'linear:write'; readonly beforeRequest: () => void } = {
    reference: 'linear:read',
  },
): Promise<Record<string, unknown>> {
  let credential: string;
  try {
    credential = secrets.getSecret('linear:host', access.reference);
  } catch {
    throw new Error('Linear credential unavailable');
  }
  if (!/^[\x21-\x7e]{1,4096}$/.test(credential)) throw new Error('Linear credential unavailable');
  if (containsCredential(variables, credential)) throw new Error('Invalid Linear input');
  if (access.reference === 'linear:write') access.beforeRequest();
  let response: Response;
  try {
    response = await request('https://api.linear.app/graphql', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: credential, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
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
    Array.isArray(value.data)
  )
    throw new Error('Invalid or failed Linear response');
  if (containsCredential(value.data, credential)) throw new Error('Invalid Linear response');
  return value.data as Record<string, unknown>;
}
function parseLinearIssue(issue: unknown): LinearIssue {
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
  if (validateLinearIssueId(issue.identifier) !== issue.identifier)
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
  return result;
}

export async function readLinearIssue(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  issueId: string,
): Promise<LinearIssue> {
  const id = validateLinearIssueId(issueId);
  const data = await queryLinear(
    request,
    secrets,
    'query KernelIssue($id: String!) { issue(id: $id) { id identifier title description url } }',
    { id },
  );
  const issue = parseLinearIssue(data.issue);
  if (uuid.test(id) ? issue.id !== id : issue.identifier !== id)
    throw new Error('Linear Issue identity mismatch');
  return issue;
}
export interface LinearIssueListInput {
  readonly team: string;
  readonly limit: number;
  readonly after?: string;
}
function validCursor(cursor: unknown): cursor is string {
  return typeof cursor === 'string' && /^[\x21-\x7e]{1,2048}$/.test(cursor);
}
export function validateLinearIssueListInput(input: LinearIssueListInput): void {
  if (
    !/^[A-Z][A-Z0-9]{0,31}$/.test(input.team) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 50 ||
    (input.after !== undefined && !validCursor(input.after))
  )
    throw new Error('Invalid Linear list scope or page');
}
export async function listLinearIssues(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  input: LinearIssueListInput,
): Promise<{
  readonly provider: 'linear';
  readonly nodes: readonly LinearIssue[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}> {
  validateLinearIssueListInput(input);
  const data = await queryLinear(
    request,
    secrets,
    'query KernelIssues($team: String!, $first: Int!, $after: String) { issues(first: $first, after: $after, filter: { team: { key: { eq: $team } } }) { nodes { id identifier title description url } pageInfo { hasNextPage endCursor } } }',
    { team: input.team, first: input.limit, after: input.after ?? null },
  );
  const connection = data.issues;
  if (
    !connection ||
    typeof connection !== 'object' ||
    Array.isArray(connection) ||
    !('nodes' in connection) ||
    !Array.isArray(connection.nodes) ||
    connection.nodes.length > input.limit ||
    !('pageInfo' in connection)
  )
    throw new Error('Invalid Linear Issue page');
  const info = connection.pageInfo;
  if (
    !info ||
    typeof info !== 'object' ||
    Array.isArray(info) ||
    !('hasNextPage' in info) ||
    typeof info.hasNextPage !== 'boolean' ||
    !('endCursor' in info) ||
    (info.endCursor !== null && !validCursor(info.endCursor)) ||
    (info.hasNextPage &&
      (connection.nodes.length === 0 || info.endCursor === null || info.endCursor === input.after))
  )
    throw new Error('Invalid Linear page info');
  const values: readonly unknown[] = connection.nodes;
  const nodes = values.map(parseLinearIssue);
  if (
    nodes.some((issue) => !issue.identifier.startsWith(input.team + '-')) ||
    new Set(nodes.map((issue) => issue.id)).size !== nodes.length
  )
    throw new Error('Linear list scope or identity mismatch');
  return {
    provider: 'linear',
    nodes,
    pageInfo: { hasNextPage: info.hasNextPage, endCursor: info.endCursor },
  };
}
