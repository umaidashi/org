import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createTask } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { saveSandboxArtifact } from '../src/sandbox/artifact.js';
import { parseTaskCommand, runTaskCommand } from '../src/tasks/cli.js';

test('Task artifact content reads only an attached immutable hash blob and denies another Task', async () => {
  const home = mkdtempSync('/tmp/org-task-artifact-content-'),
    db = home + '/org.db';
  const tasks = new SqliteTaskProvider(db);
  try {
    tasks.create(
      createTask({ title: 'first', objective: 'check' }, { id: 'first', createdAt: 'now' }),
    );
    tasks.create(
      createTask({ title: 'other', objective: 'check' }, { id: 'other', createdAt: 'now' }),
    );
    const uri = await saveSandboxArtifact(db + '.artifacts', Buffer.from('{"status":"success"}'));
    tasks.linkArtifact('first', { id: 'proof', uri, createdAt: 'now' }, 'output');
    const output: string[] = [];
    await runTaskCommand(
      parseTaskCommand([
        'task',
        'artifact-content',
        'first',
        '--artifact',
        'proof',
        '--db',
        db,
        '--json',
      ]),
      (line) => output.push(line),
    );
    assert.deepEqual(JSON.parse(output[0] ?? ''), {
      id: 'proof',
      uri,
      createdAt: 'now',
      content: '{"status":"success"}',
    });
    await assert.rejects(
      async () =>
        runTaskCommand(
          parseTaskCommand([
            'task',
            'artifact-content',
            'other',
            '--artifact',
            'proof',
            '--db',
            db,
          ]),
          () => {
            throw new Error('unexpected output');
          },
        ),
      /Task artifact not found/,
    );
  } finally {
    tasks.close();
    rmSync(home, { recursive: true, force: true });
  }
});
