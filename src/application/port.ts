export interface CommandResult {
  readonly code: 0 | 1 | 2;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}
export function parseCommandResult(value: unknown): CommandResult {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('code' in value) ||
    !('stdout' in value) ||
    !('stderr' in value) ||
    (value.code !== 0 && value.code !== 1 && value.code !== 2) ||
    !Array.isArray(value.stdout) ||
    !Array.isArray(value.stderr)
  )
    throw new Error('Invalid daemon command response');
  const lines = (entries: readonly unknown[]): readonly string[] =>
    entries.map((entry) => {
      if (typeof entry !== 'string') throw new Error('Invalid daemon output line');
      return entry;
    });
  return { code: value.code, stdout: lines(value.stdout), stderr: lines(value.stderr) };
}
