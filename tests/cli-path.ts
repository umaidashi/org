import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'org-test-cli-'));
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
const build = await Bun.build({
  entrypoints: [new URL('../src/cli.ts', import.meta.url).pathname],
  target: 'bun',
  outdir: directory,
});
if (!build.success) throw new AggregateError(build.logs, 'Test CLI build failed');
export const cli = join(directory, 'cli.js');
