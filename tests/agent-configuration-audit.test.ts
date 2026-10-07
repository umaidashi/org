import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { collectAudit } from '../src/audit/service.js';

test('Agent registration and reporting changes expose immutable Audit with atomic rollback and no legacy backfill', () => {
  const home = mkdtempSync('/tmp/org-agent-config-audit-'),
    path = home + '/org.db';
  let agents = new SqliteAgentRepository(path);
  const audit = () =>
    collectAudit(
      { list: () => [] },
      agents,
      { list: () => [], history: () => [], operationHistory: () => [] },
      { list: () => [] },
      { operationHistory: () => [] },
      { operationHistory: () => [] },
      { operationHistory: () => [] },
    );
  const agent = (id: string) =>
    createAgent({ name: id, role: 'Tester', runtime: 'codex' }, { id, createdAt: 'before' });
  try {
    agents.insert(agent('chief'));
    agents.insert(agent('worker'));
    agents.setReportsTo('worker', 'chief', 'changed');
    const records = audit();
    assert.equal(records.filter((entry) => entry.tool === 'agent.register').length, 2);
    assert.equal(records.filter((entry) => entry.tool === 'agent.reporting.change').length, 1);
    agents.setReportsTo('worker', 'chief', 'no-op');
    assert.deepEqual(audit(), records);
    assert.throws(() => agents.setReportsTo('chief', 'worker', 'cycle'), /cycle/);
    assert.deepEqual(audit(), records);
    agents.close();
    agents = new SqliteAgentRepository(path);
    assert.deepEqual(audit(), records);
    const raw = new Database(path);
    try {
      raw.exec(
        "CREATE TRIGGER fail_config_record BEFORE INSERT ON agent_configuration_history BEGIN SELECT RAISE(ABORT,'record failure'); END;",
      );
      assert.throws(() => agents.insert(agent('rollback')), /record failure/);
      assert.ok(!agents.list().some((entry) => entry.id === 'rollback'));
      assert.throws(() => agents.setReportsTo('worker', null, 'rollback'), /record failure/);
      assert.equal(agents.list().find((entry) => entry.id === 'worker')?.reportsTo, 'chief');
      assert.equal(agents.reportingHistory('worker').length, 1);
      assert.deepEqual(audit(), records);
      raw.exec('DROP TRIGGER fail_config_record');
      for (const sql of [
        'DELETE FROM agent_configuration_history',
        "UPDATE agent_configuration_history SET at='forged'",
        'INSERT OR REPLACE INTO agent_configuration_history SELECT * FROM agent_configuration_history LIMIT 1',
      ])
        assert.throws(() => raw.exec(sql), /immutable/);
    } finally {
      raw.close();
    }
    const legacy = new Database(home + '/legacy.db');
    legacy.exec(
      "CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT UNIQUE,role TEXT,runtime TEXT,created_at TEXT);INSERT INTO agents VALUES('old','old','Tester','codex','old');",
    );
    legacy.close();
    const migrated = new SqliteAgentRepository(home + '/legacy.db');
    try {
      assert.equal(
        collectAudit(
          { list: () => [] },
          migrated,
          { list: () => [], history: () => [], operationHistory: () => [] },
          { list: () => [] },
          { operationHistory: () => [] },
          { operationHistory: () => [] },
          { operationHistory: () => [] },
        ).length,
        0,
      );
    } finally {
      migrated.close();
    }
  } finally {
    agents.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('same-timestamp Agent configuration Audit retains numeric reporting chronology for recent logs', () => {
  const agents = new SqliteAgentRepository(':memory:');
  try {
    for (const id of ['chief', 'worker'])
      agents.insert(
        createAgent(
          { name: id, role: 'Tester', runtime: 'codex' },
          { id, createdAt: '2026-10-07T00:00:00.000Z' },
        ),
      );
    for (let i = 0; i < 12; i++)
      agents.setReportsTo('worker', i % 2 === 0 ? 'chief' : null, '2026-10-07T01:00:00.000Z');
    const audit = collectAudit(
      { list: () => [] },
      agents,
      { list: () => [], history: () => [], operationHistory: () => [] },
      { list: () => [] },
      { operationHistory: () => [] },
      { operationHistory: () => [] },
      { operationHistory: () => [] },
    );
    assert.deepEqual(
      audit
        .filter((entry) => entry.tool === 'agent.reporting.change')
        .map((entry) => Number(entry.outputRef.split('/').at(-1))),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    assert.equal(audit.at(-1)?.outputRef, 'org://agents/worker/reporting/12');
  } finally {
    agents.close();
  }
});
