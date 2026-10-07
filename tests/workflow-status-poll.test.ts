import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createEvent } from '../src/events/domain.js';
import { pollTaskWorkflowObservations } from '../src/workflows/task-observe.js';
test('Workflow poll selects blocked executions with observation or successful terminal receipt and propagates errors without invoking', async () => {
  const running = changeTask(
    changeTask(
      createTask(
        { title: 't', objective: 'o', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
      { owner: 'a' },
      '1',
    ),
    { status: 'running' },
    '2',
  );
  const blocked = changeTask(running, { status: 'blocked' }, '3');
  const receipt = createEvent(
    {
      type: 'workflow.unconfirmed',
      source: 'workflow:n8n',
      payload: { taskId: 't', phase: 'observation' },
    },
    { id: 'e', createdAt: '3' },
  );
  let calls = 0;
  const tasks = {
    list: () => [
      blocked,
      { ...blocked, id: 'unrelated' },
      { ...blocked, id: 'approval', status: 'waiting_approval' as const },
      { ...blocked, kind: 'work_item' as const },
    ],
    get: () => blocked,
  };
  const events = { list: () => [receipt] };
  await pollTaskWorkflowObservations(tasks, events, async (id, version) => {
    calls++;
    assert.equal(id, 't');
    assert.equal(version, blocked.version);
    return blocked;
  });
  assert.equal(calls, 1);
  let later = 0;
  await assert.rejects(
    pollTaskWorkflowObservations(
      { list: () => [blocked, { ...blocked, id: 'later' }], get: (id) => ({ ...blocked, id }) },
      {
        list: () => [
          receipt,
          { ...receipt, id: 'later-receipt', payload: { taskId: 'later', phase: 'observation' } },
        ],
      },
      async (id) => {
        if (id === 't') throw Error('status failed');
        later++;
        return { ...blocked, id };
      },
    ),
  );
  assert.equal(later, 1);
  await pollTaskWorkflowObservations(
    tasks,
    events,
    async () => {
      calls++;
      return blocked;
    },
    AbortSignal.abort(),
  );
  assert.equal(calls, 1);
  await pollTaskWorkflowObservations(
    { ...tasks, get: () => ({ ...blocked, status: 'waiting_approval' }) },
    events,
    async () => {
      calls++;
      return blocked;
    },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    pollTaskWorkflowObservations(tasks, events, async () => {
      throw Error('status failed');
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      assert.ok(error.errors[0] instanceof Error);
      assert.match(error.errors[0].message, /status failed/);
      return true;
    },
  );
  await pollTaskWorkflowObservations(
    tasks,
    { list: () => [{ ...receipt, payload: { taskId: 't', phase: 'invocation' } }] },
    async () => {
      calls++;
      return blocked;
    },
  );
  assert.equal(calls, 1);
  const claim = createEvent(
    { type: 'workflow.requested', source: 'workflow:n8n', payload: { taskId: 't' } },
    { id: 'request', createdAt: '2' },
  );
  const terminal = createEvent(
    {
      type: 'workflow.status_observed',
      source: 'workflow:n8n',
      payload: { requestId: 'request', status: 'success' },
    },
    { id: 'request:status:terminal', createdAt: '3' },
  );
  await pollTaskWorkflowObservations(tasks, { list: () => [claim, terminal] }, async () => {
    calls++;
    return blocked;
  });
  assert.equal(calls, 2);
  for (const event of [
    { ...terminal, payload: { ...terminal.payload, status: 'error' } },
    { ...terminal, id: 'manual-observation' },
    { ...terminal, source: 'foreign' },
  ]) {
    await pollTaskWorkflowObservations(tasks, { list: () => [claim, event] }, async () => {
      throw new Error('Unexpected artifact retry');
    });
  }
});
