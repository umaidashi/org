import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEvent, createSubscription } from '../src/events/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteDeliveryJournal } from '../src/daemon/sqlite.js';
import { dispatchEvents } from '../src/daemon/service.js';
import { planDeliveries } from '../src/daemon/domain.js';
test('overlapping Workflow deferrals converge on the same deferred receipt', () => {
  const journal = new SqliteDeliveryJournal(':memory:');
  try {
    const event = createEvent(
      { type: 'workflow.requested', source: 'manual' },
      { id: 'e', createdAt: 'now' },
    );
    const subscription = createSubscription(
      { subscriberType: 'workflow', subscriberId: 'flow', eventPattern: '**' },
      { id: 's', createdAt: 'later' },
    );
    const plan = planDeliveries([event], [subscription])[0];
    assert.ok(plan);
    journal.begin(plan);
    journal.begin(plan);
    const first = journal.defer(plan.key, 'not implemented');
    assert.deepEqual(journal.defer(plan.key, 'not implemented'), first);
    assert.throws(() => journal.defer(plan.key, 'different'), /conflict/);
  } finally {
    journal.close();
  }
});
test('real Task commit survives receipt failure and retry finishes receipt without duplicate history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'org-delivery-recovery-'));
  let tasks: SqliteTaskProvider | undefined;
  let journal: SqliteDeliveryJournal | undefined;
  let db: Database | undefined;
  try {
    const path = join(dir, 'org.db');
    tasks = new SqliteTaskProvider(path);
    journal = new SqliteDeliveryJournal(path);
    db = new Database(path);
    const event = createEvent(
      { type: 'manual.requested', source: 'manual' },
      { id: 'e', createdAt: 'now' },
    );
    const subscription = createSubscription(
      { subscriberType: 'agent', subscriberId: 'dev', eventPattern: '**' },
      { id: 's', createdAt: 'later' },
    );
    const bus = { list: () => [event], subscriptions: () => [subscription] };
    const agents = {
      list: () => [
        { id: 'dev', name: 'Dev', role: 'Developer', runtime: 'codex', createdAt: 'now' },
      ],
    };
    db.exec(
      "CREATE TRIGGER fail_receipt BEFORE UPDATE ON deliveries WHEN NEW.status='delivered' BEGIN SELECT RAISE(ABORT, 'receipt failure'); END",
    );
    const taskProvider = tasks;
    const receipts = journal;
    assert.throws(() => dispatchEvents(bus, agents, taskProvider, receipts), /receipt failure/);
    assert.equal(tasks.list().length, 1);
    const task = tasks.list()[0];
    assert.ok(task);
    const history = tasks.history(task.id);
    assert.equal(journal.list()[0]?.status, 'pending');
    db.exec('DROP TRIGGER fail_receipt');
    const result = dispatchEvents(bus, agents, tasks, journal);
    assert.equal(result[0]?.status, 'delivered');
    assert.equal(result[0]?.attempts, 2);
    assert.deepEqual(tasks.history(task.id), history);
    assert.equal(tasks.list().length, 1);
  } finally {
    db?.close();
    journal?.close();
    tasks?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
