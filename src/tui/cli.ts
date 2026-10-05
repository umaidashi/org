import { emitKeypressEvents } from 'node:readline';
import { requestApplication } from '../daemon/client.js';
import { readMonitor, renderMonitor } from './monitor.js';
import type { MonitorSection } from './monitor.js';

export async function runTui(socket: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('TUI requires an interactive terminal');
  const input = process.stdin;
  const output = process.stdout;
  const wasRaw = input.isRaw;
  let stopped = false;
  let snapshot: readonly MonitorSection[] = [];
  let active: Promise<void> | undefined;
  let failure: unknown;
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = () => {
    stopped = true;
    finish?.();
  };
  const draw = () => {
    if (!stopped)
      output.write(
        '\u001b[H\u001b[2J' + renderMonitor(snapshot, output.columns ?? 80, output.rows ?? 24),
      );
  };
  const refresh = () => {
    if (stopped || active) return;
    active = readMonitor((argv) => requestApplication(socket, argv))
      .then((value) => {
        snapshot = value;
        draw();
      })
      .catch((error) => {
        failure = error;
        stop();
      })
      .finally(() => {
        active = undefined;
      });
  };
  const key = (_text: string, info: { name?: string; ctrl?: boolean }) => {
    if (info.name === 'q' || (info.ctrl && info.name === 'c')) stop();
    else if (info.name === 'r') refresh();
  };
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  input.on('keypress', key);
  input.on('end', stop);
  output.on('resize', draw);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const timer = setInterval(refresh, 1000);
  try {
    output.write('\u001b[?1049h\u001b[?25l');
    refresh();
    await done;
    await active;
    if (failure !== undefined) throw failure;
  } finally {
    clearInterval(timer);
    input.off('keypress', key);
    input.off('end', stop);
    output.off('resize', draw);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    input.setRawMode(wasRaw);
    input.pause();
    output.write('\u001b[?25h\u001b[?1049l');
  }
}
