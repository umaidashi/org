import { execFileSync } from 'node:child_process';
import type { PublicFile } from './public-content.ts';

export function publicHistoryFiles(
  root: string,
  revisions: readonly string[],
): readonly PublicFile[] {
  if (revisions.length === 0) return [];
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const commits = git(['rev-list', '--reverse', ...revisions])
    .trim()
    .split('\n')
    .filter(Boolean);
  const blobs = new Map<string, string>();
  const files = new Map<string, PublicFile>();
  for (const commit of commits) {
    for (const entry of git(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const [mode, type, oid] = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (tab < 0 || type !== 'blob' || oid === undefined || mode === '120000')
        throw new Error('Unsupported public history entry');
      let body = blobs.get(oid);
      if (body === undefined) {
        body = git(['cat-file', 'blob', oid]);
        blobs.set(oid, body);
      }
      files.set(`${path}:${oid}`, { path, body });
    }
  }
  return [...files.values()];
}
