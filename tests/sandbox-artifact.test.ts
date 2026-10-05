import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises';
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
