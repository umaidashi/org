import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withGitSnapshot } from './git-snapshot.ts';
import { parsePushUpdates } from './push-input.ts';

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

const root = process.cwd();
const mode = process.argv[2];
try {
  if (mode === 'pre-commit') {
    withGitSnapshot(root, { kind: 'index' }, (snapshot) => {
      if (existsSync(join(snapshot, '.env'))) throw new Error('Do not commit .env');
      run('npm', ['run', 'check:static'], snapshot);
    });
  } else if (mode === 'pre-push' || mode === 'head') {
    const revisions =
      mode === 'head'
        ? [execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()]
        : parsePushUpdates(readFileSync(0, 'utf8'));
    for (const revision of revisions) {
      console.log(`Verifying committed tree ${revision}`);
      withGitSnapshot(root, { kind: 'commit', revision }, (snapshot) => {
        run('npm', ['run', 'check'], snapshot);
        const envFile = join(root, '.env');
        run(
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
          snapshot,
        );
      });
    }
  } else {
    throw new Error('Expected pre-commit, pre-push or head');
  }
} catch (error) {
  console.error(`Local gate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
