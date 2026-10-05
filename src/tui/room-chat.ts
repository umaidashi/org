import { createInterface } from 'node:readline';
import { requestApplication } from '../daemon/client.js';
import { openRoomChat, readRoomChat, processRoomChat } from './chat.js';
export async function runRoomChat(socket: string, roomId: string, humanId: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('TUI requires an interactive terminal');
  const request = (argv: string[]) => requestApplication(socket, argv);
  await openRoomChat(request, roomId, humanId);
  const display = async () => {
    const lines = await readRoomChat(request, roomId);
    for (const line of lines) console.log(line);
  };
  await display();
  console.log('Room chat — /refresh read | /quit exit | Ctrl-C exit');
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let stopped = false;
  const markStopped = () => {
    stopped = true;
  };
  const stop = () => {
    markStopped();
    input.close();
  };
  input.on('close', markStopped);
  input.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  input.setPrompt('> ');
  try {
    input.prompt();
    await processRoomChat(
      input,
      request,
      roomId,
      humanId,
      display,
      () => input.prompt(),
      () => stopped,
    );
  } finally {
    input.off('SIGINT', stop);
    input.off('close', markStopped);
    process.off('SIGTERM', stop);
    input.close();
    process.stdin.pause();
  }
}
