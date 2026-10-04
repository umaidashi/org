#!/usr/bin/env bun
import { executeApplication, parseApplicationCommand, usage } from './application/cli.js';
import type { CommandResult } from './application/port.js';
import { parseTransport } from './application/transport.js';
import { requestApplication } from './daemon/client.js';
import { parseDaemonCommand, runDaemonCommand } from './daemon/cli.js';

export async function main(argv: string[]): Promise<number> {
  let transport: ReturnType<typeof parseTransport>;
  try {
    transport = parseTransport(argv);
    if (transport.help) {
      console.log(
        `${usage}\nNormal commands connect to daemon. Use --direct for local database administration.`,
      );
      return 0;
    }
    if (transport.daemon) {
      if (transport.direct) throw new Error('--direct is not available for daemon commands');
      const command = parseDaemonCommand(argv);
      try {
        await runDaemonCommand(command);
        return 0;
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
      }
    }
    parseApplicationCommand(transport.argv);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 2;
  }
  let result: CommandResult;
  try {
    result = transport.direct
      ? executeApplication(transport.argv, transport.db)
      : await requestApplication(transport.socket, transport.argv);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (const line of result.stdout) console.log(line);
  for (const line of result.stderr) console.error(line);
  return result.code;
}
process.exitCode = await main(process.argv.slice(2));
