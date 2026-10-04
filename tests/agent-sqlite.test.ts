import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import { registerAgent } from '../src/agents/service.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';

test('TypeScript reads the legacy Python SQLite schema without rewriting identity or creation time', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-legacy-db-'));
  const path = join(directory, 'org.db');
  const legacy = new Database(path);
  try {
    legacy.exec(`CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
      runtime TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    legacy
      .prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?)')
      .run(
        '11111111-1111-4111-8111-111111111111',
        'cto',
        'CTO',
        'codex',
        '2026-10-04T00:00:00+00:00',
      );
  } finally {
    legacy.close();
  }
  const repository = new SqliteAgentRepository(path);
  try {
    assert.deepEqual(repository.list(), [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'cto',
        role: 'CTO',
        runtime: 'codex',
        createdAt: '2026-10-04T00:00:00+00:00',
      },
    ]);
    registerAgent(
      repository,
      { name: 'chief', role: 'Chief', runtime: 'claude-code' },
      {
        id: '22222222-2222-4222-8222-222222222222',
        createdAt: '2026-10-04T00:01:00.000Z',
      },
    );
    assert.deepEqual(
      repository.list().map((agent) => agent.name),
      ['chief', 'cto'],
    );
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an invalid agent does not reach the real repository and duplicate identity is not mislabeled as name conflict', () => {
  const repository = new SqliteAgentRepository(':memory:');
  const identity = { id: 'agent-1', createdAt: '2026-10-04T00:00:00.000Z' };
  try {
    assert.throws(
      () => registerAgent(repository, { name: '', role: 'CTO', runtime: 'codex' }, identity),
      /name/,
    );
    assert.deepEqual(repository.list(), []);
    registerAgent(repository, { name: 'cto', role: 'CTO', runtime: 'codex' }, identity);
    assert.throws(
      () => registerAgent(repository, { name: 'chief', role: 'Chief', runtime: 'codex' }, identity),
      (error: unknown) => error instanceof Error && !error.message.includes('already exists'),
    );
    assert.equal(repository.list().length, 1);
  } finally {
    repository.close();
  }
});
