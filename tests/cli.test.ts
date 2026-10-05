import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'bun:test';

interface AgentOutput {
  id: string;
  name: string;
  role: string;
  runtime: string;
  created_at: string;
}

let home: string;
let db: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'org-agent-e2e-'));
  db = join(home, 'org.db');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(args: string[], useDefaultDb = false) {
  return spawnSync(
    process.execPath,
    ['--no-env-file', cli, '--direct', ...(useDefaultDb ? [] : ['--db', db]), ...args],
    {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}

function create(name = 'cto', role = 'CTO', runtime = 'codex', useDefaultDb = false) {
  return run(['agent', 'create', name, '--role', role, '--runtime', runtime], useDefaultDb);
}

function rows(useDefaultDb = false): AgentOutput[] {
  const result = run(['agent', 'list', '--json'], useDefaultDb);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout) as AgentOutput[];
}

test('empty registry reports no agents and returns an empty JSON array', () => {
  assert.deepEqual(rows(), []);
  const result = run(['agent', 'list']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No agents registered/);
});

test('agents survive separate CLI processes with stable identity and name ordering', () => {
  assert.equal(create().status, 0);
  assert.equal(create('chief', 'Chief of Staff', 'claude-code').status, 0);
  const first = rows();
  assert.deepEqual(
    first.map((agent) => agent.name),
    ['chief', 'cto'],
  );
  assert.deepEqual(
    first.map((agent) => agent.role),
    ['Chief of Staff', 'CTO'],
  );
  assert.deepEqual(
    first.map((agent) => agent.runtime),
    ['claude-code', 'codex'],
  );
  assert.equal(new Set(first.map((agent) => agent.id)).size, 2);
  for (const agent of first) {
    assert.match(agent.id, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
    assert.match(agent.created_at, /(?:Z|\+00:00)$/);
    assert.ok(Number.isFinite(Date.parse(agent.created_at)));
  }
  assert.deepEqual(rows(), first);
});

test('duplicate registration fails without replacing the existing agent', () => {
  assert.equal(create().status, 0);
  const original = rows();
  const duplicate = create('cto', 'Changed', 'claude-code');
  assert.equal(duplicate.status, 1);
  assert.equal(duplicate.stdout, '');
  assert.match(duplicate.stderr, /cto.*already exists/);
  assert.deepEqual(rows(), original);
});

test('text output includes id name role and runtime', () => {
  assert.equal(create().status, 0);
  const agent = rows()[0];
  assert.ok(agent);
  const result = run(['agent', 'list']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ID\tNAME\tROLE\tRUNTIME/);
  assert.ok(result.stdout.includes(`${agent.id}\tcto\tCTO\tcodex`));
});

test('empty or whitespace-only identity fields cannot register an agent', () => {
  for (const field of ['name', 'role', 'runtime'] as const) {
    for (const value of ['', '   ']) {
      const input = { name: 'cto', role: 'CTO', runtime: 'codex', [field]: value };
      const result = create(input.name, input.role, input.runtime);
      assert.equal(result.status, 1, `${field}: ${result.stderr}`);
      assert.match(result.stderr, new RegExp(field));
      assert.deepEqual(rows(), []);
    }
  }
});

test('missing database parent directories are created', () => {
  db = join(home, 'nested', 'data', 'org.db');
  assert.equal(create().status, 0);
  assert.ok(existsSync(db));
  assert.equal(rows()[0]?.name, 'cto');
});

test('storage errors return failure on stderr without a stack trace', () => {
  const blocker = join(home, 'blocker');
  writeFileSync(blocker, 'not a directory');
  db = join(blocker, 'org.db');
  for (const result of [create(), run(['agent', 'list', '--json'])]) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Error:/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

test('unicode and quote characters are saved as values rather than SQL', () => {
  const name = '研究者\'"; DROP TABLE agents; --';
  assert.equal(create(name, '調査', 'claude-code').status, 0);
  const agent = rows()[0];
  assert.equal(agent?.name, name);
  assert.equal(agent?.role, '調査');
  assert.equal(agent?.runtime, 'claude-code');
  assert.equal(create('cto').status, 0);
  assert.equal(rows().length, 2);
});

test('default database is persisted only under the isolated HOME', () => {
  assert.equal(create('cto', 'CTO', 'codex', true).status, 0);
  assert.equal(rows(true)[0]?.name, 'cto');
  assert.ok(existsSync(join(home, '.local', 'share', 'org', 'org.db')));
  assert.equal(existsSync(db), false);
});

test('invalid arguments fail before creating a database and help succeeds', () => {
  for (const args of [
    [],
    ['agent', 'unknown'],
    ['agent', 'create', 'cto'],
    ['agent', 'list', '--typo'],
    ['agent', 'list', 'extra'],
    ['agent', 'list', '--role', 'CTO'],
    ['agent', 'list', '--runtime', 'codex'],
    ['agent', 'create', 'cto', 'extra', '--role', 'CTO', '--runtime', 'codex'],
    ['agent', 'create', 'cto', '--role', 'CTO', '--runtime', 'codex', '--json'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(existsSync(db), false);
  }
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /agent/);
  assert.equal(existsSync(db), false);
});

test('an explicitly empty database path cannot silently register an ephemeral agent', () => {
  for (const path of ['', '   ']) {
    const result = run(
      ['--db', path, 'agent', 'create', 'cto', '--role', 'CTO', '--runtime', 'codex'],
      true,
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /database path/i);
    assert.equal(existsSync(db), false);
  }
});

test('a corrupted database is reported as storage failure rather than an empty registry', () => {
  writeFileSync(db, 'this is not a SQLite database');
  const result = run(['agent', 'list', '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Error:/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});
