import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SnapshotSource = { kind: 'index' } | { kind: 'commit'; revision: string };

export function withGitSnapshot(
  root: string,
  source: SnapshotSource,
  check: (snapshot: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'org-git-check-'));
  const options = { cwd: root, maxBuffer: 64 * 1024 * 1024 };
  try {
    if (source.kind === 'index') {
      execFileSync('git', ['checkout-index', '--all', `--prefix=${directory}/`], options);
    } else {
      if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/.test(source.revision)) {
        throw new Error('A commit snapshot requires a full object id');
      }
      const archive = execFileSync('git', ['archive', '--format=tar', source.revision], options);
      execFileSync('tar', ['-xf', '-', '-C', directory], {
        input: archive,
        maxBuffer: options.maxBuffer,
      });
    }
    const dependencies = join(root, 'node_modules');
    if (existsSync(dependencies)) symlinkSync(dependencies, join(directory, 'node_modules'), 'dir');
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
