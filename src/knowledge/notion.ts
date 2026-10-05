import { createHash } from 'node:crypto';
import { boundedJson } from '../runtime/http.js';
import type { SecretStore } from '../secrets/port.js';
export function validateNotionPageId(value: string): string {
  if (
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value)
  )
    throw new Error('Invalid Notion page ID');
  const compact = value.replaceAll('-', '').toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
export async function readNotionDocument(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  pageId: string,
): Promise<
  Readonly<{ provider: 'notion'; id: string; url: string; content: string; contentHash: string }>
> {
  const id = validateNotionPageId(pageId);
  let credential: string;
  try {
    credential = secrets.getSecret('knowledge:host', 'notion:read');
  } catch {
    throw new Error('Notion credential unavailable');
  }
  if (!/^[\x21-\x7e]{1,4096}$/.test(credential)) throw new Error('Notion credential unavailable');
  let response: Response;
  try {
    response = await request(`https://api.notion.com/v1/pages/${id}/markdown`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${credential}`,
        'Notion-Version': '2026-03-11',
        Accept: 'application/json',
      },
    });
  } catch {
    throw new Error('Notion request failed');
  }
  if (response.status !== 200) {
    const error = new Error(`Notion request failed: ${response.status}`);
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
    throw new Error('Invalid Notion response');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('object' in value) ||
    value.object !== 'page_markdown' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    validateNotionPageId(value.id) !== id ||
    !('markdown' in value) ||
    typeof value.markdown !== 'string' ||
    value.markdown.includes(credential) ||
    !('truncated' in value) ||
    value.truncated !== false ||
    !('unknown_block_ids' in value) ||
    !Array.isArray(value.unknown_block_ids) ||
    value.unknown_block_ids.length !== 0
  )
    throw new Error('Invalid or incomplete Notion document');
  return {
    provider: 'notion',
    id,
    url: 'https://www.notion.so/' + id.replaceAll('-', ''),
    content: value.markdown,
    contentHash: createHash('sha256').update(value.markdown, 'utf8').digest('hex'),
  };
}
