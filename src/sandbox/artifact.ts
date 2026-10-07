import { constants } from 'node:fs';
import { open, mkdir, lstat, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export async function readSandboxArtifact(directory: string, uri: string): Promise<string> {
  const digest = /^org:\/\/artifacts\/([a-f0-9]{64})$/.exec(uri)?.[1];
  if (digest === undefined) throw new Error('Invalid Artifact URI');
  const path = join(directory, digest);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('Artifact must be a regular file, not a symlink');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1048576) throw new Error('Artifact size limit');
    const bytes = await handle.readFile();
    if (bytes.length > 1048576 || hash(bytes) !== digest)
      throw new Error('Artifact integrity mismatch');
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}
export async function saveSandboxArtifact(directory: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length > 1048576) throw new Error('Artifact size limit');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    throw new Error('Artifact directory must not be a symlink');
  const digest = hash(bytes);
  const uri = `org://artifacts/${digest}`;
  const temporary = join(directory, '.tmp-' + randomUUID());
  const file = await open(temporary, 'wx', 0o400);
  try {
    try {
      await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    try {
      await link(temporary, join(directory, digest));
    } catch (error) {
      if (
        error === null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
  } finally {
    await unlink(temporary);
  }
  await readSandboxArtifact(directory, uri);
  return uri;
}
