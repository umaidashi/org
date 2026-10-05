import type { CommandResult } from '../application/port.js';
export type MonitorKind = 'agent' | 'room' | 'task' | 'event';
export interface MonitorSection {
  readonly kind: MonitorKind;
  readonly count: number;
  readonly rows: readonly string[];
}
export async function readMonitor(
  request: (argv: string[]) => Promise<CommandResult>,
): Promise<readonly MonitorSection[]> {
  return Promise.all(
    (['agent', 'room', 'task', 'event'] as const).map(async (kind) => {
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
      const rows: string[] = [];
      const items: readonly unknown[] = value;
      for (const item of items) {
        if (item === null || typeof item !== 'object' || Array.isArray(item))
          throw new Error('Invalid monitor record');
        if (rows.length < 10)
          rows.push(
            [
              'id',
              kind === 'task' ? 'title' : 'name',
              kind === 'agent'
                ? 'role'
                : kind === 'room'
                  ? 'type'
                  : kind === 'task'
                    ? 'status'
                    : 'type',
            ]
              .map((key): unknown => {
                const field: unknown = Object.hasOwn(item, key)
                  ? Reflect.get(item, key)
                  : undefined;
                return field;
              })
              .filter((field): field is string => typeof field === 'string')
              .map((field) =>
                Array.from(field)
                  .map((char) => {
                    const code = char.codePointAt(0) ?? 0;
                    return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
                  })
                  .join('')
                  .slice(0, 160),
              )
              .join('  '),
          );
      }
      return { kind, count: value.length, rows };
    }),
  );
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
