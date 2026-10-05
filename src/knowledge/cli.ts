import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SqliteRoomRepository } from '../rooms/sqlite.js';
import { importNotionSnapshot } from './snapshot.js';
import { parseArgs } from 'node:util';
import { EnvironmentSecretStore } from '../secrets/environment.js';
import { readNotionDocument, validateNotionPageId } from './notion.js';
export function parseKnowledgeCommand(
  argv: string[],
): Readonly<{ pageId: string; json: boolean; db: string; room?: string; human?: string }> {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      room: { type: 'string' },
      human: { type: 'string' },
    },
  });
  const [noun, action, id, ...extra] = parsed.positionals;
  if (noun !== 'knowledge' || action !== 'notion' || id === undefined || extra.length)
    throw new Error('Expected knowledge notion PAGE_ID');
  const { room, human } = parsed.values;
  if (
    (room === undefined) !== (human === undefined) ||
    (room !== undefined && (!room.trim() || !human?.trim()))
  )
    throw new Error('Notion import requires both --room and --human');
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim()) throw new Error('Missing --db');
  return {
    pageId: validateNotionPageId(id),
    json: parsed.values.json ?? false,
    db,
    ...(room === undefined ? {} : { room, human }),
  };
}
export async function runKnowledgeCommand(
  command: ReturnType<typeof parseKnowledgeCommand>,
  output: (line: string) => void,
): Promise<void> {
  const secrets = new EnvironmentSecretStore([
    { actorId: 'knowledge:host', reference: 'notion:read', environmentVariable: 'NOTION_API_KEY' },
  ]);
  const read = () => readNotionDocument(fetch, secrets, command.pageId);
  let result: unknown;
  if (command.room !== undefined && command.human !== undefined) {
    const rooms = new SqliteRoomRepository(command.db);
    try {
      result = await importNotionSnapshot(rooms, read, command.room, command.human, {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      });
    } finally {
      rooms.close();
    }
  } else result = await read();
  output(JSON.stringify(result, null, command.json ? undefined : 2));
}
