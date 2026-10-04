import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPublicFiles } from './public-content.ts';
import { publicHistoryFiles } from './public-history.ts';

export function runPublicReview(
  snapshot: string,
  root: string,
  history: readonly string[] = [],
): void {
  const envFile = join(root, '.env');
  const result = spawnSync(
    process.execPath,
    [
      '--no-env-file',
      ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []),
      fileURLToPath(import.meta.url),
      snapshot,
      ...history,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Public content review failed');
}
if (import.meta.main && process.argv[2] !== undefined) {
  try {
    const root = process.argv[2];
    const paths: string[] = [];
    function walk(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) paths.push(relative(root, path));
        else throw new Error('Unexpected public symlink');
      }
    }
    const historyOnly = process.argv.length > 3;
    if (historyOnly) {
      // A history scan reads Git objects and must not depend on the worktree.
    } else if (existsSync(join(root, '.git'))) {
      paths.push(
        ...execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
          .split('\0')
          .filter(Boolean),
      );
    } else walk(root);
    const secrets = [process.env.TYPESAFE_API_KEY, process.env.TYPESAFEAI_API_KEY].filter(
      (value): value is string => value !== undefined,
    );
    checkPublicFiles(
      paths.map((path) => ({ path, body: readFileSync(join(root, path), 'utf8') })),
      secrets,
    );
    const history = publicHistoryFiles(process.cwd(), process.argv.slice(3));
    checkPublicFiles(history, secrets);
    if (history.length > 0)
      console.log(`Reachable public history checked: ${history.length} file versions`);
    console.log(`Public content checked: ${paths.length} files`);
  } catch (error) {
    console.error(
      `Public content gate failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
