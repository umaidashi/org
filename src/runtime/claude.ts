import type { ProcessInput, ProcessResult } from './process.js';
import type { RuntimeTurnInput, RuntimeTurnResult } from './port.js';
export function claudeCommand(
  input: RuntimeTurnInput,
  executable: string,
): { argv: string[]; input: string } {
  if (!input.agent.id.trim() || !input.agent.role.trim() || !input.message.trim())
    throw new Error('Agent identity, role and message are required');
  if (input.sessionId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(input.sessionId))
    throw new Error('Invalid runtime session ID');
  const argv = [
    executable,
    '--print',
    '--bare',
    '--output-format',
    'json',
    '--tools',
    '',
    '--system-prompt-snapshot',
    'off',
    '--system-prompt',
    JSON.stringify({ agent: input.agent, instruction: input.instruction }),
  ];
  if (input.sessionId !== undefined) argv.push('--resume', input.sessionId);
  return { argv, input: input.message };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseClaudeTurn(output: string, expectedSession?: string): RuntimeTurnResult {
  const value: unknown = JSON.parse(output);
  if (
    !isRecord(value) ||
    value.type !== 'result' ||
    value.subtype !== 'success' ||
    value.is_error !== false
  )
    throw new Error('Claude result is not successful');
  if (
    typeof value.session_id !== 'string' ||
    !value.session_id.trim() ||
    typeof value.result !== 'string'
  )
    throw new Error('Claude result fields missing');
  if (expectedSession !== undefined && expectedSession !== value.session_id)
    throw new Error('Claude session mismatch');
  return { sessionId: value.session_id, text: value.result };
}
export async function runClaudeTurn(
  runner: (input: ProcessInput) => Promise<ProcessResult>,
  turn: RuntimeTurnInput,
  options: Omit<ProcessInput, 'argv' | 'input'> & { readonly executable: string },
): Promise<RuntimeTurnResult> {
  const command = claudeCommand(turn, options.executable);
  const result = await runner({ ...options, ...command });
  if (result.reason !== 'exited' || result.exitCode !== 0)
    throw new Error(`Claude process failed: ${result.reason}, exit ${result.exitCode}`);
  return parseClaudeTurn(result.stdout, turn.sessionId);
}
