import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { CommandResult } from '../src/application/port.js';
import { readMonitor, renderMonitor } from '../src/tui/monitor.js';

test('monitor reads only public list commands and renders bounded Japanese summaries without terminal control or payload', async () => {
  const calls: string[][] = [];
  const snapshot = await readMonitor(async (argv) => {
    calls.push(argv);
    return {
      code: 0,
      stderr: [],
      stdout: [
        JSON.stringify([
          {
            id: 'id',
            agentId: 'id',
            role: 'chief',
            name: '日本語\u001b[2J\n',
            title: '調査',
            type: 'direct',
            status: argv[0] === 'session' ? 'idle' : 'waiting_approval',
            payload: { secret: 'private-body' },
            content: 'private-body',
          },
        ]),
      ],
    };
  });
  assert.deepEqual(calls, [
    ['agent', 'list', '--json'],
    ['room', 'list', '--json'],
    ['task', 'list', '--json'],
    ['event', 'list', '--json'],
    ['session', 'list', '--json'],
  ]);
  const screen = renderMonitor(snapshot, 80, 24);
  assert.match(screen, /日本語/);
  assert.match(screen, /waiting_approval/);
  assert.doesNotMatch(screen, /private-body|\n\n\n/);
  assert.equal(screen.includes(String.fromCharCode(27)), false);
  assert.ok(screen.split('\n').length <= 24);
  assert.ok(renderMonitor(snapshot, 20, 8).split('\n').length <= 8);
});

test('monitor propagates failed reads and rejects malformed public results', async () => {
  await assert.rejects(() =>
    readMonitor(async () => ({ code: 1, stdout: [], stderr: ['failed'] })),
  );
  for (const stdout of [['not-json'], ['{}'], ['[null]'], ['[]', '[]']])
    await assert.rejects(() => readMonitor(async () => ({ code: 0, stdout, stderr: [] })));
});

test('monitor clips Japanese text to terminal cells after resize', () => {
  const screen = renderMonitor([{ kind: 'agent', count: 1, rows: ['日本語日本語日本語'] }], 8, 6);
  assert.ok(screen.split('\n').every((line) => Bun.stringWidth(line) <= 8));
});

test('monitor keeps all four section headings and representative rows visible when Agent and Room lists grow', () => {
  const sections = (['agent', 'room', 'task', 'event'] as const).map((kind) => ({
    kind,
    count: 30,
    rows: Array.from({ length: 10 }, (_, i) => kind + '-item-' + i),
  }));
  const screen = renderMonitor(sections, 80, 24);
  for (const kind of ['agent', 'room', 'task', 'event']) {
    assert.ok(screen.includes(kind + ' (30)'));
    assert.ok(screen.includes(kind + '-item-0'));
  }
  const narrow = renderMonitor(sections, 80, 5);
  for (const kind of ['agent', 'room', 'task', 'event']) assert.ok(narrow.includes(kind + ' (30)'));
  assert.ok(screen.split('\n').length <= 24);
});

const records = {
  agent: [
    { id: 'a', name: 'Chief', role: 'chief' },
    { id: 'b', name: 'Unused', role: 'worker' },
  ],
  room: [{ id: 'r', title: '設計室', type: 'group' }],
  task: [],
  event: [],
  session: [
    { id: 's1', agentId: 'a', status: 'running', roomId: 'r' },
    { id: 's2', agentId: 'a', status: 'running', roomId: 'r2' },
    { id: 's3', agentId: 'a', status: 'failed', error: 'private-body' },
    { id: 's4', agentId: 'a', status: 'idle', providerSessionId: 'private-body' },
    { id: 's5', agentId: 'a', status: 'stopped' },
    { id: 's6', agentId: 'other', status: 'running' },
  ],
};
function response(argv: string[], override?: { kind: string; value: unknown }): CommandResult {
  const kind = argv[0] ?? '';
  const value: unknown = override?.kind === kind ? override.value : Reflect.get(records, kind);
  return { code: 0, stderr: [], stdout: [JSON.stringify(value)] };
}
test('monitor shows Room title and all Session states separately for each Agent', async () => {
  const sections = await readMonitor(async (argv) => response(argv));
  assert.deepEqual(sections[1]?.rows, ['r  設計室  group']);
  assert.deepEqual(sections[0]?.rows, [
    'running=2 idle=1 failed=1 stopped=1  a  Chief  chief',
    'sessions=0  b  Unused  worker',
  ]);
  assert.doesNotMatch(renderMonitor(sections, 160, 24), /private-body/);
});
test('monitor rejects missing or blank required fields even outside displayed ten rows', async () => {
  for (const value of [
    [{}],
    [{ id: 'r', title: '  ', type: 'group' }],
    [...Array.from({ length: 10 }, () => records.room[0]), { id: 'r', type: 'group' }],
  ])
    await assert.rejects(() =>
      readMonitor(async (argv) => response(argv, { kind: 'room', value })),
    );
  for (const value of [
    [{ id: 's', agentId: 'a', status: 'sleeping' }],
    [{ id: 's', status: 'idle' }],
  ])
    await assert.rejects(() =>
      readMonitor(async (argv) => response(argv, { kind: 'session', value })),
    );
  await assert.rejects(() =>
    readMonitor(async (argv) =>
      argv[0] === 'session' ? { code: 1, stdout: [], stderr: ['unavailable'] } : response(argv),
    ),
  );
});

test('monitor keeps all four Session counts visible at 80 columns with real UUID and long Japanese Agent name', async () => {
  const agent = {
    id: '12345678-1234-1234-1234-123456789abc',
    name: 'とても長い日本語の監視担当エージェント',
    role: 'Chief of Staff',
  };
  const sections = await readMonitor(async (argv) => {
    if (argv[0] === 'agent') return response(argv, { kind: 'agent', value: [agent] });
    if (argv[0] === 'session')
      return response(argv, {
        kind: 'session',
        value: [
          { id: 's1', agentId: agent.id, status: 'running' },
          { id: 's2', agentId: agent.id, status: 'idle' },
          { id: 's3', agentId: agent.id, status: 'failed' },
          { id: 's4', agentId: agent.id, status: 'stopped' },
        ],
      });
    return response(argv);
  });
  const screen = renderMonitor(sections, 80, 24);
  for (const state of ['running', 'idle', 'failed', 'stopped'])
    assert.ok(screen.includes(state + '=1'), screen);
});
