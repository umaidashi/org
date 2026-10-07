import { parseArgs } from 'node:util';
import type { CommandResult } from '../application/port.js';
export type TuiCommand =
  | { readonly mode: 'monitor' }
  | { readonly mode: 'chat'; readonly roomId: string; readonly humanId: string };
export type ChatRequest = (argv: string[]) => Promise<CommandResult>;
export function parseTuiCommand(argv: string[]): TuiCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: { room: { type: 'string' }, human: { type: 'string' } },
  });
  const roomOpen =
    positionals.length === 3 && positionals[0] === 'room' && positionals[1] === 'open';
  if (!roomOpen && (positionals.length !== 1 || positionals[0] !== 'tui'))
    throw new Error('Expected org tui or room open ROOM_ID');
  if (roomOpen && values.room !== undefined) throw new Error('Room open takes one Room ID');
  const roomId = roomOpen ? positionals[2] : values.room;
  if (!roomOpen && roomId === undefined && values.human === undefined) return { mode: 'monitor' };
  if (!roomId?.trim() || !values.human?.trim() || roomId.length > 256 || values.human.length > 256)
    throw new Error('TUI chat requires --room ID and --human ID');
  return { mode: 'chat', roomId, humanId: values.human };
}
function readJson(result: CommandResult): unknown {
  if (result.code !== 0 || result.stdout.length !== 1) throw new Error('Unable to read Room chat');
  try {
    return JSON.parse(result.stdout[0] ?? '');
  } catch {
    throw new Error('Invalid Room chat response');
  }
}
export async function openRoomChat(
  request: ChatRequest,
  roomId: string,
  humanId: string,
): Promise<void> {
  const room = readJson(await request(['room', 'get', roomId, '--json']));
  if (
    !room ||
    typeof room !== 'object' ||
    !('id' in room) ||
    room.id !== roomId ||
    !('archivedAt' in room) ||
    room.archivedAt !== null ||
    !('participants' in room) ||
    !Array.isArray(room.participants)
  )
    throw new Error('Chat requires an active Room');
  const participants: readonly unknown[] = room.participants;
  if (
    !participants.some(
      (p) =>
        p !== null &&
        typeof p === 'object' &&
        'kind' in p &&
        p.kind === 'human' &&
        'id' in p &&
        p.id === humanId,
    )
  )
    throw new Error('Human is not a Room participant');
}
export async function sendRoomChat(
  request: ChatRequest,
  roomId: string,
  humanId: string,
  content: string,
): Promise<void> {
  if (!content.trim() || Buffer.byteLength(content) > 65536)
    throw new Error('Chat input must be nonempty and at most 64KiB');
  const result = await request([
    'room',
    'send',
    roomId,
    '--human',
    humanId,
    '--content=' + content,
    '--json',
  ]);
  if (result.code !== 0)
    throw new Error(
      'Unable to send Room Message; outcome was not confirmed. No retry was performed',
    );
}
export async function readRoomChat(
  request: ChatRequest,
  roomId: string,
): Promise<readonly string[]> {
  const messages = readJson(await request(['room', 'messages', roomId, '--json']));
  if (!Array.isArray(messages)) throw new Error('Invalid Room Message response');
  const records: readonly unknown[] = messages;
  return records.slice(-20).map((message) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('content' in message) ||
      typeof message.content !== 'string' ||
      !('sender' in message) ||
      !message.sender ||
      typeof message.sender !== 'object' ||
      !('id' in message.sender) ||
      typeof message.sender.id !== 'string'
    )
      throw new Error('Invalid Room Message');
    return displayText(message.sender.id, 256) + ': ' + displayText(message.content, 2048);
  });
}
function displayText(value: string, limit: number): string {
  return Array.from(value)
    .slice(0, limit)
    .map((char) => {
      const c = char.codePointAt(0) ?? 0;
      return c < 32 || (c >= 127 && c <= 159) ? ' ' : char;
    })
    .join('');
}

export async function processRoomChat(
  lines: AsyncIterable<string>,
  request: ChatRequest,
  roomId: string,
  humanId: string,
  display: () => Promise<void>,
  prompt: () => void,
  isStopped: () => boolean,
): Promise<void> {
  for await (const line of lines) {
    if (isStopped() || line === '/quit') break;
    if (line.trim() && line !== '/refresh') await sendRoomChat(request, roomId, humanId, line);
    if (isStopped()) break;
    await display();
    if (isStopped()) break;
    prompt();
  }
}
