import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withGitSnapshot } from './git-snapshot.ts';
import { runSemanticReview } from './semantic-review.ts';
import { parsePushUpdates } from './push-input.ts';
import { isDocumentationOnlyTree } from './documentation-tree.ts';
import { runPublicReview } from './public-review.ts';

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
      runPublicReview(snapshot, root);
      if (existsSync(join(snapshot, '.env'))) throw new Error('Do not commit .env');
      run('bun', ['--no-env-file', 'run', 'check:static'], snapshot);
    });
  } else if (mode === 'pre-push' || mode === 'head') {
    const revisions =
      mode === 'head'
        ? [execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()]
        : parsePushUpdates(readFileSync(0, 'utf8'));
    if (revisions.length > 0) runPublicReview(root, root, revisions);
    for (const revision of revisions) {
      console.log(`Verifying committed tree ${revision}`);
      withGitSnapshot(root, { kind: 'commit', revision }, (snapshot) => {
        runPublicReview(snapshot, root);
        if (!existsSync(join(snapshot, 'package.json'))) {
          if (!isDocumentationOnlyTree(snapshot))
            throw new Error('Runtime tree requires package.json');
          console.log('Documentation-only bootstrap tree: no runtime checks apply');
          return;
        }
        run('bun', ['--no-env-file', 'run', 'check'], snapshot);
        runSemanticReview(snapshot, root);
      });
    }
  } else {
    throw new Error('Expected pre-commit, pre-push or head');
  }
} catch (error) {
  console.error(`Local gate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
