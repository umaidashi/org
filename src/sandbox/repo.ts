import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SandboxCancelledError } from './domain.js';
const execute = promisify(execFile);
export async function exportSandboxRepo(
  repo: string,
  signal?: AbortSignal,
): Promise<readonly { readonly path: string; readonly base64: string }[]> {
  const git = async (args: readonly string[]) => {
    if (signal?.aborted) throw new SandboxCancelledError('Sandbox execution cancelled');
    try {
      const result = await execute('git', ['-C', repo, ...args], {
        encoding: 'buffer',
        ...(signal === undefined ? {} : { signal }),
        timeout: 10000,
        maxBuffer: 1048576,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
        },
      });
      return result.stdout;
    } catch (error) {
      if (signal?.aborted) throw new SandboxCancelledError('Sandbox execution cancelled');
      throw error;
    }
  };
  const commit = (await git(['rev-parse', '--verify', 'HEAD^{commit}'])).toString('utf8').trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid Git commit');
  const tree = await git(['ls-tree', '-rlz', commit]);
  if (Buffer.from(tree.toString('utf8')).compare(tree) !== 0)
    throw new Error('Sandbox requires UTF-8 paths');
  const files: { path: string; base64: string }[] = [];
  let total = 0;
  for (const entry of tree.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40,64}) +([0-9]+)\t(.+)$/.exec(entry);
    if (!match)
      throw new Error('Sandbox repo requires regular files without symlinks or submodules');
    const [, mode, object, size, path] = match;
    if (mode === undefined || object === undefined || size === undefined || path === undefined)
      throw new Error('Invalid Git tree');
    const parts = path.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..') || path.includes('\\'))
      throw new Error('Invalid repo path');
    if (
      parts.some((part) =>
        /^(?:\.git|node_modules|\.env(?:\..*)?|\.npmrc|\.netrc|\.aws|\.ssh|\.codex|\.claude|\.org-execution\.ts)$/i.test(
          part,
        ),
      ) ||
      /\.(?:pem|key|p12|pfx)$/i.test(path)
    )
      continue;
    total += Number(size);
    if (files.length >= 2000 || Number(size) > 1048576 || total > 8388608)
      throw new Error('Sandbox repo size limit');
    const bytes = await git(['cat-file', 'blob', object]);
    if (bytes.length !== Number(size)) throw new Error('Git blob size mismatch');
    files.push({ path, base64: bytes.toString('base64') });
  }
  return files;
}
