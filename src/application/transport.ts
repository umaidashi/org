import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export interface Transport {
  readonly argv: string[];
  readonly db: string;
  readonly socket: string;
  readonly direct: boolean;
  readonly help: boolean;
  readonly daemon: boolean;
}
export function parseTransport(argv: string[]): Transport {
  const parsed = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    tokens: true,
    options: {
      db: { type: 'string' },
      socket: { type: 'string' },
      direct: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const remove = new Set<number>();
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind === 'option' && ['db', 'socket', 'direct'].includes(token.name)) {
      if (seen.has(token.name)) throw new Error(`Duplicate --${token.name}`);
      seen.add(token.name);
      remove.add(token.index);
      if (token.value !== undefined && !token.inlineValue) remove.add(token.index + 1);
    }
  }
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (typeof db !== 'string' || !db.trim()) throw new Error('Database path must not be empty');
  const rawSocket = parsed.values.socket ?? socketForDatabase(db);
  if (typeof rawSocket !== 'string' || !rawSocket.trim())
    throw new Error('Socket path must not be empty');
  if (parsed.values.direct && parsed.values.socket !== undefined)
    throw new Error('--direct cannot be used with --socket');
  return {
    argv: argv.filter((_, index) => !remove.has(index)),
    db,
    socket: resolve(rawSocket),
    direct: parsed.values.direct === true,
    help: parsed.values.help === true,
    daemon: parsed.positionals[0] === 'daemon',
  };
}

export function socketForDatabase(db: string): string {
  return `${resolve(db)}.sock`;
}
