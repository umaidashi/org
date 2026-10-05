import type { CommandResult } from '../application/port.js';
export type MonitorKind = 'agent' | 'room' | 'task' | 'event';
export interface MonitorSection {
  readonly kind: MonitorKind;
  readonly count: number;
  readonly rows: readonly string[];
}
function field(item: unknown, key: string): string {
  if (item === null || typeof item !== 'object' || Array.isArray(item))
    throw new Error('Invalid monitor record');
  const value: unknown = Object.hasOwn(item, key) ? Reflect.get(item, key) : undefined;
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error('Invalid monitor field');
  return value;
}
function sanitize(value: string): string {
  return Array.from(value)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
    })
    .join('')
    .slice(0, 160);
}
export async function readMonitor(
  request: (argv: string[]) => Promise<CommandResult>,
): Promise<readonly MonitorSection[]> {
  const kinds = ['agent', 'room', 'task', 'event', 'session'] as const;
  const lists = await Promise.all(
    kinds.map(async (kind) => {
      const result = await request([kind, 'list', '--json']);
      if (result.code !== 0) throw new Error(`Unable to read ${kind} monitor`);
      if (result.stdout.length !== 1) throw new Error('Invalid monitor response');
      let value: unknown;
      try {
        value = JSON.parse(result.stdout[0] ?? '');
      } catch {
        throw new Error('Invalid monitor response');
      }
      if (!Array.isArray(value)) throw new Error('Invalid monitor response');
      const items: readonly unknown[] = value;
      return items;
    }),
  );
  const counts = new Map<
    string,
    { running: number; idle: number; failed: number; stopped: number }
  >();
  for (const item of lists[4] ?? []) {
    field(item, 'id');
    const agentId = field(item, 'agentId');
    const status = field(item, 'status');
    if (status !== 'running' && status !== 'idle' && status !== 'failed' && status !== 'stopped')
      throw new Error('Invalid monitor Session status');
    const count = counts.get(agentId) ?? { running: 0, idle: 0, failed: 0, stopped: 0 };
    count[status] += 1;
    counts.set(agentId, count);
  }
  return (['agent', 'room', 'task', 'event'] as const).map((kind, index) => {
    const items = lists[index] ?? [];
    const rows = items.map((item) => {
      const id = field(item, 'id');
      const keys =
        kind === 'agent'
          ? ['name', 'role']
          : kind === 'room'
            ? ['title', 'type']
            : kind === 'task'
              ? ['title', 'status']
              : ['type'];
      const fields = [id, ...keys.map((key) => field(item, key))];
      if (kind === 'agent') {
        const count = counts.get(id);
        fields.unshift(
          count === undefined
            ? 'sessions=0'
            : `running=${count.running} idle=${count.idle} failed=${count.failed} stopped=${count.stopped}`,
        );
      }
      return fields.map(sanitize).join('  ');
    });
    return { kind, count: items.length, rows: rows.slice(0, 10) };
  });
}
export function renderMonitor(
  sections: readonly MonitorSection[],
  columns: number,
  rows: number,
): string {
  const width = Math.max(1, Math.min(240, columns));
  const height = Math.max(1, Math.min(100, rows));
  const lines = ['org monitor — q/Ctrl-C quit | r refresh'];
  const rowsPerSection =
    sections.length === 0
      ? 0
      : Math.max(0, Math.floor((height - 1 - sections.length) / sections.length));
  for (const section of sections) {
    lines.push(`${section.kind} (${section.count})`);
    lines.push(...section.rows.slice(0, rowsPerSection).map((row) => '  ' + row));
  }
  return lines
    .slice(0, height)
    .map((line) => {
      let clipped = '';
      for (const char of line) {
        if (Bun.stringWidth(clipped + char) > width) break;
        clipped += char;
      }
      return clipped;
    })
    .join('\n');
}
