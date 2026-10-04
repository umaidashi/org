import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
let home: string;
let db: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'org-task-e2e-'));
  db = join(home, 'org.db');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
function run(args: string[]) {
  return spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
    timeout: 10_000,
  });
}
function json(args: string[]): Record<string, unknown> {
  const result = run([...args, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const value: unknown = JSON.parse(result.stdout);
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function id(value: Record<string, unknown>): string {
  assert.equal(typeof value.id, 'string');
  return String(value.id);
}
function create(title: string, args: string[] = []) {
  return json(['task', 'create', title, '--objective', 'Ship working software', ...args]);
}

test('work item and internal execution task persist separately with parent and assignment history', () => {
  assert.equal(
    run(['agent', 'create', 'dev', '--role', 'Developer', '--runtime', 'codex']).status,
    0,
  );
  const agentResult = run(['agent', 'list', '--json']);
  const agents = JSON.parse(agentResult.stdout) as { id: string }[];
  const owner = agents[0]?.id;
  assert.ok(owner);
  const work = create('認証機能', ['--priority', '2', '--label', 'backend']);
  assert.equal(work.kind, 'work_item');
  assert.equal(work.status, 'pending');
  const child = create('schema調査', ['--kind', 'execution_task', '--parent', id(work)]);
  assert.equal(child.kind, 'execution_task');
  assert.equal(child.parentId, id(work));
  const assigned = json(['task', 'assign', id(child), '--owner', owner]);
  assert.equal(assigned.owner, owner);
  assert.equal(assigned.status, 'assigned');
  for (const status of ['running', 'blocked', 'waiting_approval', 'completed']) {
    assert.equal(json(['task', 'update', id(child), '--status', status]).status, status);
  }
  assert.deepEqual(json(['task', 'get', id(child)]), json(['task', 'get', id(child)]));
  const historyResult = run(['task', 'history', id(child), '--json']);
  assert.equal(historyResult.status, 0, historyResult.stderr);
  const history = JSON.parse(historyResult.stdout) as { status: string; version: number }[];
  assert.deepEqual(
    history.map((entry) => entry.status),
    ['pending', 'assigned', 'running', 'blocked', 'waiting_approval', 'completed'],
  );
  assert.deepEqual(
    history.map((entry) => entry.version),
    [0, 1, 2, 3, 4, 5],
  );
  const listed = run([
    'task',
    'list',
    '--kind',
    'execution_task',
    '--status',
    'completed',
    '--json',
  ]);
  assert.equal(listed.status, 0, listed.stderr);
  const rows = JSON.parse(listed.stdout) as { id: string }[];
  assert.deepEqual(
    rows.map((row) => row.id),
    [id(child)],
  );
});

test('invalid transitions and references leave persistent task and history unchanged', () => {
  const task = create('Test');
  const before = run(['task', 'history', id(task), '--json']).stdout;
  for (const args of [
    ['task', 'update', id(task), '--status', 'completed'],
    ['task', 'assign', id(task), '--owner', 'missing-agent'],
    ['task', 'update', id(task), '--dependency', id(task)],
    ['task', 'update', id(task), '--parent', id(task)],
  ]) {
    assert.equal(run(args).status, 1, args.join(' '));
    assert.equal(run(['task', 'history', id(task), '--json']).stdout, before);
  }
  assert.equal(json(['task', 'get', id(task)]).status, 'pending');
  assert.equal(run(['task', 'get', 'missing-task']).status, 1);
  assert.equal(
    run(['task', 'create', 'bad', '--objective', 'x', '--parent', 'missing-task']).status,
    1,
  );
  assert.equal(run(['task', 'create', 'bad', '--objective', 'x', '--status', 'unknown']).status, 2);
});

test('dependencies and cycles are enforced across independent CLI processes', () => {
  assert.equal(run(['agent', 'create', 'dev', '--role', 'dev', '--runtime', 'codex']).status, 0);
  const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
  const owner = agents[0]?.id;
  assert.ok(owner);
  const first = create('Prerequisite');
  const second = create('Dependent', ['--dependency', id(first)]);
  assert.equal(run(['task', 'update', id(first), '--dependency', id(second)]).status, 1);
  json(['task', 'assign', id(second), '--owner', owner]);
  assert.equal(run(['task', 'update', id(second), '--status', 'running']).status, 1);
  json(['task', 'assign', id(first), '--owner', owner]);
  json(['task', 'update', id(first), '--status', 'running']);
  json(['task', 'update', id(first), '--status', 'completed']);
  assert.equal(json(['task', 'update', id(second), '--status', 'running']).status, 'running');
});

test('task comments and output artifacts can be written and retrieved via separate CLI processes', () => {
  const task = create('Deliver result');
  const comment = json([
    'task',
    'comment',
    id(task),
    '--body',
    'Reviewed result',
    '--actor',
    'human',
  ]);
  assert.equal(comment.body, 'Reviewed result');
  assert.equal(
    json([
      'task',
      'artifact',
      id(task),
      '--artifact',
      'result',
      '--uri',
      'file:///tmp/result.txt',
      '--direction',
      'output',
    ]).version,
    1,
  );
  const comments = run(['task', 'comments', id(task), '--json']);
  assert.equal(comments.status, 0, comments.stderr);
  assert.match(comments.stdout, /Reviewed result/);
  const artifacts = run(['task', 'artifacts', id(task), '--json']);
  assert.equal(artifacts.status, 0, artifacts.stderr);
  assert.match(artifacts.stdout, /file:\/\/\/tmp\/result.txt/);
});

test('task parser rejects malformed options before touching storage', () => {
  for (const args of [
    ['task', 'create', 'x'],
    ['task', 'create', 'x', '--objective', 'x', '--kind', 'unknown'],
    ['task', 'create', 'x', '--objective', 'x', '--priority', '-1'],
    ['task', 'create', 'x', '--objective', 'x', '--priority', '1.5'],
    ['task', 'create', 'x', '--objective', 'x', '--priority', '999999999999999999'],
    ['task', 'list', 'extra'],
    ['task', 'list', '--status', 'unknown'],
    ['task', 'get'],
    ['task', 'assign', 'id'],
    ['task', 'update', 'id'],
    ['task', 'artifact', 'id', '--artifact', 'a', '--uri', 'x', '--direction', 'bad'],
    ['task', 'unknown'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
  }
});

test('failed tasks retain their original history and reject subsequent state changes', () => {
  const task = create('Failure');
  assert.equal(json(['task', 'update', id(task), '--status', 'failed']).status, 'failed');
  const history = run(['task', 'history', id(task), '--json']).stdout;
  assert.equal(run(['task', 'update', id(task), '--title', 'changed']).status, 1);
  assert.equal(run(['task', 'update', id(task), '--status', 'pending']).status, 1);
  assert.equal(run(['task', 'history', id(task), '--json']).stdout, history);
});

test('mistaken dependencies and parent links can be removed to unblock a task', () => {
  assert.equal(run(['agent', 'create', 'dev', '--role', 'dev', '--runtime', 'codex']).status, 0);
  const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
  const owner = agents[0]?.id;
  assert.ok(owner);
  const prerequisite = create('Failed prerequisite');
  const task = create('Task', [
    '--dependency',
    id(prerequisite),
    '--parent',
    id(prerequisite),
    '--label',
    'mistake',
  ]);
  json(['task', 'update', id(prerequisite), '--status', 'failed']);
  json(['task', 'assign', id(task), '--owner', owner]);
  assert.equal(run(['task', 'update', id(task), '--status', 'running']).status, 1);
  const cleared = json([
    'task',
    'update',
    id(task),
    '--clear-dependencies',
    '--clear-parent',
    '--clear-labels',
  ]);
  assert.deepEqual(cleared.dependencies, []);
  assert.deepEqual(cleared.labels, []);
  assert.equal(cleared.parentId, null);
  assert.equal(json(['task', 'update', id(task), '--status', 'running']).status, 'running');
});
