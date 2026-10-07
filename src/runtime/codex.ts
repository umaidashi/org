import type { ProcessInput, ProcessResult } from './process.js';
import type { RuntimeTurnInput as CodexTurnInput, RuntimeTurnResult } from './port.js';
export type { RuntimeTurnInput as CodexTurnInput, RuntimeTurnResult } from './port.js';
export function codexCommand(
  input: CodexTurnInput,
  executable: string,
): { argv: string[]; input: string } {
  if (!input.agent.id.trim() || !input.agent.role.trim() || !input.message.trim())
    throw new Error('Agent identity, role and message are required');
  if (input.sessionId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(input.sessionId))
    throw new Error('Invalid runtime session ID');
  const argv = [executable, 'exec'];
  if (input.sessionId !== undefined) argv.push('resume');
  argv.push(
    '--json',
    '--ignore-user-config',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
    '-c',
    'features.shell_tool=false',
    '-c',
    'features.view_image=false',
    '-c',
    'features.hooks=false',
    '-c',
    'notify=[]',
    '-c',
    'features.apps=false',
    '-c',
    'features.plugins=false',
    '-c',
    'features.multi_agent=false',
    '-c',
    'web_search="disabled"',
  );
  if (input.sessionId !== undefined) argv.push(input.sessionId);
  argv.push('-');
  return {
    argv,
    input: JSON.stringify({
      agent: input.agent,
      instruction: input.instruction,
      message: input.message,
    }),
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid Codex event');
  return value;
}
export function parseCodexTurn(output: string, expectedSession?: string): RuntimeTurnResult {
  let sessionId = expectedSession;
  let completed = false;
  const messages: string[] = [];
  for (const line of output.split('\n').filter((line) => line.trim())) {
    const parsed: unknown = JSON.parse(line);
    const event = object(parsed);
    if (typeof event.type !== 'string') throw new Error('Codex event type missing');
    if (completed) throw new Error('Codex event after completed turn');
    if (event.type === 'error' || event.type === 'turn.failed')
      throw new Error('Codex turn failed');
    if (event.type === 'thread.started') {
      if (typeof event.thread_id !== 'string' || !event.thread_id.trim())
        throw new Error('Codex session ID missing');
      if (sessionId !== undefined && sessionId !== event.thread_id)
        throw new Error('Codex session mismatch');
      sessionId = event.thread_id;
    }
    if (event.type === 'item.completed') {
      const item = object(event.item);
      if (item.type === 'agent_message') {
        if (typeof item.text !== 'string') throw new Error('Codex message text missing');
        messages.push(item.text);
      }
    }
    if (event.type === 'turn.completed') completed = true;
  }
  if (!completed || !sessionId || messages.length === 0) throw new Error('Incomplete Codex turn');
  return { sessionId, text: messages.join('\n') };
}
export async function runCodexTurn(
  runner: (input: ProcessInput) => Promise<ProcessResult>,
  turn: CodexTurnInput,
  options: Omit<ProcessInput, 'argv' | 'input'> & { readonly executable: string },
): Promise<RuntimeTurnResult> {
  const command = codexCommand(turn, options.executable);
  const result = await runner({ ...options, ...command });
  if (result.reason !== 'exited' || result.exitCode !== 0)
    throw new Error(`Codex process failed: ${result.reason}, exit ${result.exitCode}`);
  return parseCodexTurn(result.stdout, turn.sessionId);
}
