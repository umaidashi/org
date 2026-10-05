import assert from 'node:assert/strict';
import { test } from 'bun:test';
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
            name: '日本語\u001b[2J\n',
            title: '調査',
            type: 'direct',
            status: 'waiting_approval',
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
