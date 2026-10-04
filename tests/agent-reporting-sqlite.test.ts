import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createAgent, changeReportingLine } from '../src/agents/domain.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
test('legacy Agent identities gain atomic reporting lines without cycles or mutable history', () => {
  const home = mkdtempSync('/tmp/org-reporting-db-'),
    path = home + '/org.db';
  const db = new Database(path);
  db.exec(
    "CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,role TEXT NOT NULL,runtime TEXT NOT NULL,created_at TEXT NOT NULL); INSERT INTO agents VALUES('chief','chief','Chief','claude','before'),('cto','cto','CTO','codex','before')",
  );
  const first = new SqliteAgentRepository(path);
  const second = new SqliteAgentRepository(path);
  try {
    const original = first.list();
    assert.deepEqual(changeReportingLine(original, 'chief', 'cto').reportsTo, 'cto');
    assert.equal(second.setReportsTo('cto', 'chief', 'changed').reportsTo, 'chief');
    assert.throws(() => first.setReportsTo('chief', 'cto', 'later'), /cycle/);
    first.setReportsTo('cto', 'chief', 'same');
    assert.deepEqual(
      first.reportingHistory('cto').map((h) => [h.previousManager, h.manager, h.at]),
      [[null, 'chief', 'changed']],
    );
    assert.equal(first.list().find((a) => a.id === 'chief')?.reportsTo, undefined);
    const cleared = first.setReportsTo('cto', null, 'cleared');
    assert.equal(cleared.reportsTo, undefined);
    assert.deepEqual(first.list(), original);
    first.insert(
      createAgent(
        { name: 'researcher', role: 'Researcher', runtime: 'codex', reportsTo: 'chief' },
        { id: 'researcher', createdAt: 'created' },
      ),
    );
    assert.equal(first.reportingHistory('researcher')[0]?.manager, 'chief');
    assert.throws(
      () =>
        first.insert(
          createAgent(
            { name: 'missing', role: 'x', runtime: 'codex', reportsTo: 'missing-manager' },
            { id: 'missing', createdAt: 'created' },
          ),
        ),
      /not found/,
    );
    assert.equal(
      first.list().some((a) => a.id === 'missing'),
      false,
    );
    const graph = first.list(),
      history = first.reportingHistory('chief');
    db.exec(
      "CREATE TRIGGER fail_reporting BEFORE INSERT ON agent_reporting_history WHEN NEW.agent_id='chief' BEGIN SELECT RAISE(ABORT,'history failure'); END",
    );
    assert.throws(() => first.setReportsTo('chief', 'cto', 'changed'), /history failure/);
    assert.deepEqual(first.list(), graph);
    assert.deepEqual(first.reportingHistory('chief'), history);
    db.exec('PRAGMA recursive_triggers=OFF');
    for (const sql of [
      "UPDATE agent_reporting_history SET at='fake'",
      'DELETE FROM agent_reporting_history',
      "INSERT OR REPLACE INTO agent_reporting_history(sequence,agent_id,previous_manager,manager,at) SELECT sequence,agent_id,previous_manager,manager,'fake' FROM agent_reporting_history LIMIT 1",
    ])
      assert.throws(() => db.exec(sql), /immutable/);
    assert.equal(first.reportingHistory('cto').length, 2);
  } finally {
    second.close();
    first.close();
    db.close();
    rmSync(home, { recursive: true, force: true });
  }
});
