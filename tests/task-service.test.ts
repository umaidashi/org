import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTask } from '../src/tasks/domain.js';
import { assignTask } from '../src/tasks/service.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';

await test('assignment uses the public Agent port and rejects missing identities without task changes', () => {
  const tasks = new SqliteTaskProvider(':memory:');
  const agents = new SqliteAgentRepository(':memory:');
  const at = '2026-10-04T00:00:00.000Z';
  try {
    tasks.create(createTask({ title: 'x', objective: 'y' }, { id: 'task', createdAt: at }));
    assert.throws(() => assignTask(tasks, agents, 'task', 'missing', at), /Agent/);
    assert.equal(tasks.get('task').version, 0);
    agents.insert({ id: 'agent', name: 'dev', role: 'dev', runtime: 'codex', createdAt: at });
    assert.equal(assignTask(tasks, agents, 'task', 'agent', at).status, 'assigned');
    assert.equal(tasks.get('task').owner, 'agent');
  } finally {
    tasks.close();
    agents.close();
  }
});
