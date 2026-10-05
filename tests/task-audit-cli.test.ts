import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
test('Audit CLI reopens atomically saved Task execution history and includes its result snapshot', () => {
  const dir = mkdtempSync('/tmp/org-task-audit-');
  const db = dir + '/org.db';
  const tasks = new SqliteTaskProvider(db);
  try {
    tasks.create(
      createTask(
        { title: 'work', objective: 'produce', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
    );
    const assigned = tasks.update('t', { owner: 'a' }, '1');
    const running = tasks.update('t', { status: 'running' }, '2', assigned.version);
    const ready = tasks.stageExecutionResult(
      't',
      { id: 'out', uri: 'org://artifacts/fixture', createdAt: '3' },
      running.version,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
        'audit',
        'list',
        '--direct',
        '--db',
        db,
        '--json',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const entries: unknown = JSON.parse(result.stdout);
    assert.deepEqual(entries, [
      {
        id: `task:t:${running.version}`,
        actor: { kind: 'agent', id: 'a' },
        taskId: 't',
        eventId: null,
        tool: 'task.execution',
        inputRef: `org://tasks/t/versions/${assigned.version}`,
        outputRef: `org://tasks/t/versions/${running.version}`,
        at: '2',
        result: 'started',
        approvalId: null,
      },
      {
        id: `task:t:${ready.version}`,
        actor: { kind: 'agent', id: 'a' },
        taskId: 't',
        eventId: null,
        tool: 'task.execution',
        inputRef: `org://tasks/t/versions/${ready.version - 1}`,
        outputRef: `org://tasks/t/versions/${ready.version}`,
        at: '3',
        result: 'succeeded',
        approvalId: null,
      },
    ]);
  } finally {
    tasks.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
