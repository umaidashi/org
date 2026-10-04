// This function is serialized into Bun's -e argument; it must be self-contained.
async function guardian(): Promise<never> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let line = '';
  for (;;) {
    const part = await reader.read();
    if (part.done) {
      process.kill(-process.pid, 'SIGKILL');
      throw new Error('Runtime owner disconnected');
    }
    line += decoder.decode(part.value, { stream: true });
    if (line.includes('\n')) break;
  }
  const payload: unknown = JSON.parse(line.slice(0, line.indexOf('\n')));
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !('argv' in payload) ||
    !Array.isArray(payload.argv) ||
    !payload.argv.length ||
    !payload.argv.every((arg: unknown) => typeof arg === 'string' && !arg.includes('\0')) ||
    !('input' in payload) ||
    typeof payload.input !== 'string' ||
    !('env' in payload) ||
    payload.env === null ||
    typeof payload.env !== 'object'
  )
    throw new Error('Invalid Runtime guardian payload');
  const argv = payload.argv.map((arg: unknown) => {
    if (typeof arg !== 'string') throw new Error('Invalid Runtime argument');
    return arg;
  });
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(payload.env)) {
    if (typeof value !== 'string') throw new Error('Invalid Runtime environment');
    env[name] = value;
  }
  void (async () => {
    for (;;) {
      const part = await reader.read();
      if (part.done || part.value.byteLength) throw new Error('Runtime owner disconnected');
    }
  })().catch(() => process.kill(-process.pid, 'SIGKILL'));
  const child = Bun.spawn(argv, {
    env,
    stdin: new Blob([payload.input]),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exit(await child.exited);
}

export function guardianSource(): string {
  return `(${guardian.toString()})().catch(() => { process.stderr.write('Runtime guardian failed\\n'); process.exit(1); });`;
}
