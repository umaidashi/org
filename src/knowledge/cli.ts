import { parseArgs } from 'node:util';
import { EnvironmentSecretStore } from '../secrets/environment.js';
import { readNotionDocument, validateNotionPageId } from './notion.js';
export function parseKnowledgeCommand(argv: string[]): Readonly<{ pageId: string; json: boolean }> {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: { db: { type: 'string' }, json: { type: 'boolean' } },
  });
  const [noun, action, id, ...extra] = parsed.positionals;
  if (noun !== 'knowledge' || action !== 'notion' || id === undefined || extra.length)
    throw new Error('Expected knowledge notion PAGE_ID');
  return { pageId: validateNotionPageId(id), json: parsed.values.json ?? false };
}
export async function runKnowledgeCommand(
  command: ReturnType<typeof parseKnowledgeCommand>,
  output: (line: string) => void,
): Promise<void> {
  const secrets = new EnvironmentSecretStore([
    { actorId: 'knowledge:host', reference: 'notion:read', environmentVariable: 'NOTION_API_KEY' },
  ]);
  const document = await readNotionDocument(fetch, secrets, command.pageId);
  output(JSON.stringify(document, null, command.json ? undefined : 2));
}
