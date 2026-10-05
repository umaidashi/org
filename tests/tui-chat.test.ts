import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseTuiCommand, openRoomChat, sendRoomChat } from '../src/tui/chat.js';
import type { CommandResult } from '../src/application/port.js';

test('TUI chat parses a strict Room and human pair before opening a terminal', () => {
  assert.deepEqual(parseTuiCommand(['tui']), { mode: 'monitor' });
  assert.deepEqual(parseTuiCommand(['tui', '--room', 'room', '--human', 'founder']), {
    mode: 'chat',
    roomId: 'room',
    humanId: 'founder',
  });
  for (const args of [
    ['tui', '--room', 'room'],
    ['tui', '--human', 'founder'],
    ['tui', '--room', '', '--human', 'founder'],
    ['tui', 'extra'],
    ['tui', '--json'],
  ])
    assert.throws(() => parseTuiCommand(args));
});

test('Room chat validates participation then sends the exact explicit text once without retry', async () => {
  const calls: string[][] = [];
  let fail = false;
  const request = async (argv: string[]): Promise<CommandResult> => {
    calls.push(argv);
    if (argv[1] === 'get')
      return {
        code: 0,
        stderr: [],
        stdout: [
          JSON.stringify({
            id: 'room',
            archivedAt: null,
            participants: [{ kind: 'human', id: 'founder' }],
          }),
        ],
      };
    return fail
      ? { code: 1, stderr: ['private-detail'], stdout: [] }
      : { code: 0, stderr: [], stdout: ['{}'] };
  };
  await openRoomChat(request, 'room', 'founder');
  assert.equal(calls.length, 1);
  const text = '日本語 --socket literal';
  await sendRoomChat(request, 'room', 'founder', text);
  assert.deepEqual(calls[1], [
    'room',
    'send',
    'room',
    '--human',
    'founder',
    '--content=' + text,
    '--json',
  ]);
  fail = true;
  await assert.rejects(
    () => sendRoomChat(request, 'room', 'founder', 'again'),
    /Unable to send Room Message/,
  );
  assert.equal(calls.length, 3);
  await assert.rejects(() => openRoomChat(request, 'room', 'outsider'));
});

test('Room chat rejects inactive or mismatched rooms and bounds history without terminal controls', async () => {
  const { readRoomChat } = await import('../src/tui/chat.js');
  const ok = (value: unknown): CommandResult => ({
    code: 0,
    stdout: [JSON.stringify(value)],
    stderr: [],
  });
  for (const room of [
    { id: 'room', archivedAt: 'closed', participants: [{ kind: 'human', id: 'founder' }] },
    { id: 'other', archivedAt: null, participants: [{ kind: 'human', id: 'founder' }] },
    {},
  ])
    await assert.rejects(() => openRoomChat(async () => ok(room), 'room', 'founder'));
  const messages = Array.from({ length: 25 }, (_, i) => ({
    sender: { id: 'founder' },
    content: '日本語' + i + String.fromCharCode(27) + '[2J\n',
  }));
  const lines = await readRoomChat(async () => ok(messages), 'room');
  assert.equal(lines.length, 20);
  assert.ok(lines[0]?.includes('日本語5'));
  assert.ok(lines.every((line) => !line.includes(String.fromCharCode(27)) && !line.includes('\n')));
  let calls = 0;
  await assert.rejects(() =>
    sendRoomChat(
      async () => {
        calls++;
        return ok({});
      },
      'room',
      'founder',
      'x'.repeat(65537),
    ),
  );
  assert.equal(calls, 0);
});

test('chat stop during an in-flight send discards buffered input without refresh or prompt', async () => {
  const { processRoomChat } = await import('../src/tui/chat.js');
  let stopped = false;
  let sends = 0;
  let displays = 0;
  let prompts = 0;
  async function* lines() {
    yield 'first';
    yield 'buffered';
  }
  await processRoomChat(
    lines(),
    async () => {
      sends++;
      stopped = true;
      return { code: 0, stdout: ['{}'], stderr: [] };
    },
    'room',
    'founder',
    async () => {
      displays++;
    },
    () => {
      prompts++;
    },
    () => stopped,
  );
  assert.equal(sends, 1);
  assert.equal(displays, 0);
  assert.equal(prompts, 0);
});
