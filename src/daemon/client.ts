export async function requestDaemon(
  socket: string,
  action: 'status' | 'dispatch' | 'stop' | 'deliveries' | 'wakeups',
): Promise<unknown> {
  const response = await fetch(`http://org.local/v1/${action}`, {
    unix: socket,
    method: action === 'dispatch' || action === 'stop' ? 'POST' : 'GET',
    signal: AbortSignal.timeout(5000),
    headers: { Connection: 'close' },
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      value !== null &&
      typeof value === 'object' &&
      'error' in value &&
      typeof value.error === 'string'
        ? value.error
        : `Daemon request failed: ${response.status}`;
    throw new Error(message);
  }
  return value;
}
import { parseCommandResult } from '../application/port.js';
import { parseApplicationCommand } from '../application/cli.js';
import type { CommandResult } from '../application/port.js';
export async function requestApplication(socket: string, argv: string[]): Promise<CommandResult> {
  const command = parseApplicationCommand(argv);
  const response = await fetch('http://org.local/v1/command', {
    unix: socket,
    method: 'POST',
    signal:
      command.kind === 'session' ||
      (command.kind === 'sandbox' && command.command.action === 'run') ||
      (command.kind === 'room' && command.command.action === 'activate') ||
      (command.kind === 'task' && command.command.action.kind === 'run')
        ? null
        : AbortSignal.timeout(
            command.kind === 'event' && command.command.action === 'import-github' ? 40000 : 5000,
          ),
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ argv }),
  });
  if (!response.ok) throw new Error(`Daemon command transport failed: ${response.status}`);
  const value: unknown = await response.json();
  return parseCommandResult(value);
}
