import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { selectAuditLogs } from '../src/audit/logs.js';
import type { AuditEntry } from '../src/audit/domain.js';

test('logs filters exact Task and Event before taking the latest records in causal order', () => {
  const entry = (id: string, taskId: string | null, eventId: string | null): AuditEntry => ({
    id,
    taskId,
    eventId,
    actor: { kind: 'system', id: 'host' },
    tool: 'workflow.invoke',
    inputRef: 'org://inputs/digest',
    outputRef: 'org://executions/id',
    at: 'same',
    result: 'started',
    approvalId: null,
  });
  const records = [
    entry('first', 'task', 'event'),
    entry('second', 'task', 'event'),
    entry('other', 'tasks', 'event'),
  ];
  assert.deepEqual(
    selectAuditLogs(records, { taskId: 'task', eventId: 'event', limit: 1 }).map((e) => e.id),
    ['second'],
  );
  assert.deepEqual(selectAuditLogs(records, { taskId: 'absent', limit: 100 }), []);
  assert.deepEqual(selectAuditLogs(records, { limit: 100 }), records);
  for (const limit of [0, -1, 1.5, 1001, NaN])
    assert.throws(() => selectAuditLogs(records, { limit }));
});

test('Agent tail selects immutable Agent actors before limiting and never attributes a human or another Agent to that ID', () => {
  const base: AuditEntry = {
    id: 'first',
    actor: { kind: 'agent', id: 'cto' },
    taskId: 'task',
    eventId: null,
    tool: 'task.execution',
    inputRef: 'in',
    outputRef: 'out',
    at: 'same',
    result: 'started',
    approvalId: null,
  };
  const records = [
    base,
    { ...base, id: 'other', actor: { kind: 'agent' as const, id: 'researcher' } },
    { ...base, id: 'human', actor: { kind: 'human' as const, id: 'cto' } },
    { ...base, id: 'latest' },
    { ...base, id: 'later-other', actor: { kind: 'agent' as const, id: 'researcher' } },
  ];
  assert.deepEqual(selectAuditLogs(records, { agentId: 'cto', limit: 1 }), [records[3]]);
  assert.deepEqual(selectAuditLogs(records, { agentId: 'cto', taskId: 'absent', limit: 10 }), []);
  for (const agentId of ['', ' ', '\0'])
    assert.throws(() => selectAuditLogs(records, { agentId, limit: 1 }));
});
