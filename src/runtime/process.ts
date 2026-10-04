export interface ProcessInput {
  readonly argv: readonly string[];
  readonly input: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}
export interface ProcessResult {
  readonly reason: 'exited' | 'timeout' | 'cancelled' | 'output_limit';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export async function runProcess(input: ProcessInput): Promise<ProcessResult> {
  if (!input.argv.length || input.argv.some((arg) => arg.includes('\0')))
    throw new Error('Process argv must contain an executable and no NUL bytes');
  for (const value of [input.timeoutMs, input.maxOutputBytes])
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error('Process limits must be positive integers');
  if (input.timeoutMs > 2147483647)
    throw new Error('Process timeout must be at most 2147483647 milliseconds');
  if (input.signal?.aborted) return { reason: 'cancelled', exitCode: null, stdout: '', stderr: '' };
  if (process.platform === 'win32') throw new Error('Runtime process groups require POSIX');
  const child = Bun.spawn([...input.argv], {
    detached: true,
    cwd: input.cwd,
    env: { ...input.env },
    stdin: new Blob([input.input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const groupId = child.pid;
  let reason: ProcessResult['reason'] = 'exited';
  let remaining = input.maxOutputBytes;
  let groupStop: Promise<void> | undefined;
  const stopGroup = (): Promise<void> => {
    groupStop ??= (async () => {
      try {
        process.kill(-groupId, 'SIGKILL');
      } catch (error) {
        if (error !== null && typeof error === 'object' && 'code' in error) {
          if (error.code === 'ESRCH') return;
          if (error.code === 'EPERM' && process.platform === 'darwin') {
            // Darwin can report EPERM for a group containing only an unreaped zombie.
            child.kill('SIGKILL');
            await child.exited;
            try {
              process.kill(-groupId, 'SIGKILL');
              return;
            } catch (retry) {
              if (
                retry !== null &&
                typeof retry === 'object' &&
                'code' in retry &&
                retry.code === 'ESRCH'
              )
                return;
              throw retry;
            }
          }
        }
        throw error;
      }
    })();
    return groupStop;
  };
  const exited = child.exited.then(async (code) => {
    await stopGroup();
    return code;
  });
  const terminate = (cause: ProcessResult['reason']) => {
    if (reason !== 'exited') return;
    reason = cause;
    void stopGroup().catch(() => child.kill('SIGKILL'));
  };
  const cancel = () => terminate('cancelled');
  input.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => terminate('timeout'), input.timeoutMs);
  async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        const accepted = Math.min(remaining, part.value.byteLength);
        chunks.push(part.value.slice(0, accepted));
        remaining -= accepted;
        if (accepted < part.value.byteLength) terminate('output_limit');
      }
      const bytes = Buffer.concat(chunks);
      const decoded = new TextDecoder().decode(bytes, { stream: true });
      if (Buffer.byteLength(decoded) <= bytes.byteLength) return decoded;
      let size = 0;
      let prefix = '';
      for (const character of decoded) {
        const length = Buffer.byteLength(character);
        if (size + length > bytes.byteLength) break;
        prefix += character;
        size += length;
      }
      return prefix;
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      collect(child.stdout),
      collect(child.stderr),
      exited,
    ]);
    return { reason, exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', cancel);
    await stopGroup();
    await exited;
  }
}
