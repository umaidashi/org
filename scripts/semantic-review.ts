import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateSemanticReview } from './semantic-result.ts';

export function runSemanticReview(snapshot: string, root: string): void {
  const envFile = join(root, '.env');
  const result = spawnSync(
    process.execPath,
    [
      ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []),
      join(snapshot, 'node_modules', 'jev-lint', 'dist', 'cli.js'),
      'check',
      'src',
      'tests',
      'scripts',
      '--fail-on',
      'error',
      '--json',
      '--cache',
      join(root, '.jev-lint', 'baseline.json'),
      '--record',
      join(root, '.jev-lint', 'latest-run.json'),
    ],
    { cwd: snapshot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Semantic review failed (${result.status ?? result.signal})`);
  const parsed: unknown = JSON.parse(result.stdout);
  validateSemanticReview(parsed);
}
