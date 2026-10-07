import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { saveSandboxArtifact, readSandboxArtifact } from '../src/sandbox/artifact.js';
test('Sandbox artifacts are immutable content-addressed blobs and reject a replaced symlink', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'org-artifact-'));
  try {
    const artifact = await saveSandboxArtifact(dir, Buffer.from('ok'));
    assert.equal(await readSandboxArtifact(dir, artifact), 'ok');
    assert.equal(await saveSandboxArtifact(dir, Buffer.from('ok')), artifact);
    assert.match(artifact, /^org:\/\/artifacts\/[a-f0-9]{64}$/);
    const path = join(dir, artifact.split('/').at(-1) ?? '');
    await rm(path);
    await symlink('/etc/passwd', path);
    await assert.rejects(saveSandboxArtifact(dir, Buffer.from('ok')), /regular|symlink/);
    await assert.rejects(readSandboxArtifact(dir, artifact), /regular|symlink/);
    assert.ok((await readFile('/etc/passwd')).length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('Failed Artifact writes publish no partial blob and normal retry preserves concurrent content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'org-artifact-failure-'));
  const directory = join(root, 'artifacts');
  const bytes = Buffer.alloc(32768, 65);
  try {
    const fixture = join(root, 'save.ts');
    await writeFile(
      fixture,
      `import {saveSandboxArtifact} from ${JSON.stringify(new URL('../src/sandbox/artifact.ts', import.meta.url).pathname)};await saveSandboxArtifact(process.argv[2],Buffer.alloc(32768,65));`,
    );
    const child = spawnSync(
      '/bin/sh',
      [
        '-c',
        'ulimit -c 0; ulimit -f 1; exec "$1" --no-env-file "$2" "$3"',
        'owned-limit',
        process.execPath,
        fixture,
        directory,
      ],
      { env: { PATH: process.env.PATH ?? '', HOME: root }, timeout: 5000 },
    );
    assert.equal(child.error, undefined);
    assert.notEqual(child.status, 0);
    assert.deepEqual(await readdir(directory), []);
    const uris = await Promise.all([
      saveSandboxArtifact(directory, bytes),
      saveSandboxArtifact(directory, bytes),
    ]);
    assert.equal(uris[0], uris[1]);
    assert.equal(await readSandboxArtifact(directory, uris[0] ?? ''), bytes.toString('utf8'));
    assert.deepEqual(await readdir(directory), [(uris[0] ?? '').split('/').at(-1)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
