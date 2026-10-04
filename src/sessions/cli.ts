import { parseArgs } from 'node:util';
import type { SessionStore } from './port.js';
import type { LocalAgentRuntime } from '../runtime/manager.js';
export type SessionCommand =
  | {
      readonly action: 'start';
      readonly agentId: string;
      readonly roomId: string;
      readonly message: string;
      readonly instruction: string;
      readonly json: boolean;
    }
  | {
      readonly action: 'send' | 'resume';
      readonly id: string;
      readonly message: string;
      readonly instruction: string;
      readonly json: boolean;
    }
  | { readonly action: 'get' | 'stop' | 'history'; readonly id: string; readonly json: boolean }
  | { readonly action: 'list'; readonly json: boolean };
export interface SessionContext {
  readonly store: Pick<SessionStore, 'get' | 'list' | 'history'>;
  readonly runtime: Pick<LocalAgentRuntime, 'start' | 'send' | 'resume' | 'stop'>;
}
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`Session ${name} required`);
  return value;
}
export function parseSessionCommand(argv: string[]): SessionCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      agent: { type: 'string' },
      room: { type: 'string' },
      message: { type: 'string' },
      instruction: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const [noun, action, id, ...extra] = parsed.positionals;
  if (noun !== 'session' || extra.length) throw new Error('Expected session command');
  const json = parsed.values.json ?? false;
  if (action === 'start') {
    if (id !== undefined) throw new Error('Unexpected Session ID');
    return {
      action,
      agentId: required(parsed.values.agent, 'agent'),
      roomId: required(parsed.values.room, 'room'),
      message: required(parsed.values.message, 'message'),
      instruction: parsed.values.instruction ?? '',
      json,
    };
  }
  if (parsed.values.agent !== undefined || parsed.values.room !== undefined)
    throw new Error('Agent/Room options require session start');
  if (action === 'send' || action === 'resume')
    return {
      action,
      id: required(id, 'ID'),
      message:
        action === 'send'
          ? required(parsed.values.message, 'message')
          : parsed.values.message === undefined
            ? 'Continue the previous task.'
            : required(parsed.values.message, 'message'),
      instruction: parsed.values.instruction ?? '',
      json,
    };
  if (parsed.values.message !== undefined || parsed.values.instruction !== undefined)
    throw new Error('Message/instruction require session start/send/resume');
  if (action === 'list' && id === undefined) return { action, json };
  if (action === 'get' || action === 'history' || action === 'stop')
    return { action, id: required(id, 'ID'), json };
  throw new Error('Expected session start/send/resume/stop/get/list/history');
}
export async function runSessionCommand(
  command: SessionCommand,
  context: SessionContext,
): Promise<string> {
  let result: unknown;
  switch (command.action) {
    case 'start':
      result = await context.runtime.start(command);
      break;
    case 'send':
      result = await context.runtime.send(command.id, command.message, command.instruction);
      break;
    case 'resume':
      result = await context.runtime.resume(command.id, command.message, command.instruction);
      break;
    case 'stop':
      result = await context.runtime.stop(command.id);
      break;
    case 'get':
      result = context.store.get(command.id);
      break;
    case 'list':
      result = context.store.list();
      break;
    case 'history':
      result = context.store.history(command.id);
      break;
  }
  return JSON.stringify(result, null, command.json ? undefined : 2);
}
