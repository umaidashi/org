import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteEventBus } from '../src/events/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { runSandboxTask } from '../src/sandbox/service.js';
import { collectAudit } from '../src/audit/service.js';

test('Sandbox preserves actor/version-linked execution receipts without copying code or output for success and failures', async () => {
  const home = mkdtempSync('/tmp/org-sandbox-execution-audit-'),
    path = home + '/org.db';
  const tasks = new SqliteTaskProvider(path),
    events = new SqliteEventBus(path);
  const agent = createAgent(
    { name: 'worker', role: 'build', runtime: 'codex', capabilities: ['can_run_shell'] },
    { id: 'worker', createdAt: '0' },
  );
  const artifact = 'org://artifacts/' + 'a'.repeat(64);
  try {
    for (const outcome of [
      'success',
      'nonzero',
      'timeout',
      'cancelled',
      'throw',
      'save',
    ] as const) {
      tasks.create(
        createTask(
          { title: 'fixture', objective: 'verify', kind: 'execution_task' },
          { id: outcome, createdAt: '0' },
        ),
      );
      const assigned = tasks.update(outcome, { owner: agent.id }, 'assigned');
      let calls = 0;
      const execution = runSandboxTask(
        tasks,
        agent,
        async () => {
          calls++;
          if (outcome === 'throw') throw new Error('synthetic-output-sentinel');
          return {
            reason:
              outcome === 'timeout'
                ? ('timeout' as const)
                : outcome === 'cancelled'
                  ? ('cancelled' as const)
                  : ('exited' as const),
            exitCode: outcome === 'nonzero' ? 7 : 0,
            stdout: 'synthetic-output-sentinel',
            stderr: 'synthetic-error-sentinel',
          };
        },
        async () => {
          if (outcome === 'save') throw new Error('synthetic-save-sentinel');
          return artifact;
        },
        {
          code: 'console.log("synthetic-code-sentinel")',
          writable: false,
          files: [],
          timeoutMs: 1000,
          maxOutputBytes: 4096,
        },
        outcome,
        () => '2026-10-07T00:00:00.000Z',
        () => 'artifact:' + outcome,
        undefined,
        {
          events,
          digest: (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        },
      );
      if (outcome === 'success') assert.equal((await execution).status, 'waiting_approval');
      else await assert.rejects(execution);
      assert.equal(calls, 1);
      const receipts = events.list().filter((e) => e.payload.taskId === outcome);
      assert.equal(receipts.length, 2);
      assert.equal(receipts[0]?.type, 'sandbox.started');
      assert.equal(receipts[0]?.payload.actorId, agent.id);
      assert.equal(receipts[0]?.payload.taskVersion, assigned.version + 1);
      assert.equal(receipts[1]?.payload.requestId, receipts[0]?.id);
      const audit = collectAudit(
        { list: () => [] },
        { capabilityHistory: () => [] },
        tasks,
        events,
      ).filter((e) => e.tool === 'sandbox.run' && e.taskId === outcome);
      assert.equal(audit.length, 2);
      assert.equal(audit[0]?.result, 'started');
      assert.equal(
        audit[1]?.result,
        outcome === 'success' ? 'succeeded' : outcome === 'cancelled' ? 'canceled' : 'failed',
      );
      assert.equal(
        audit[1]?.outputRef,
        outcome === 'success'
          ? artifact
          : 'org://events/' + encodeURIComponent(receipts[1]?.id ?? 'missing'),
      );
      assert.equal(JSON.stringify(receipts).includes('synthetic-'), false);
    }
  } finally {
    events.close();
    tasks.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Sandbox refuses to run when initial immutable Audit claim cannot be saved', async () => {
  const home = mkdtempSync('/tmp/org-sandbox-audit-storage-'),
    path = home + '/org.db';
  const tasks = new SqliteTaskProvider(path),
    events = new SqliteEventBus(path),
    raw = new Database(path);
  try {
    tasks.create(
      createTask(
        { title: 'fixture', objective: 'verify', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
    );
    tasks.update('t', { owner: 'a' }, 'assigned');
    const agent = createAgent(
      { name: 'a', role: 'build', runtime: 'codex', capabilities: ['can_run_shell'] },
      { id: 'a', createdAt: '0' },
    );
    raw.exec(
      "CREATE TRIGGER fail_sandbox_audit BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    let calls = 0;
    await assert.rejects(
      runSandboxTask(
        tasks,
        agent,
        async () => {
          calls++;
          return { reason: 'exited', exitCode: 0, stdout: 'ok', stderr: '' };
        },
        async () => 'org://artifacts/' + 'a'.repeat(64),
        {
          code: 'console.log(1)',
          writable: false,
          files: [],
          timeoutMs: 1000,
          maxOutputBytes: 4096,
        },
        't',
        () => '2026-10-07T00:00:00.000Z',
        () => 'artifact',
        undefined,
        {
          events,
          digest: (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        },
      ),
      /audit unavailable/,
    );
    assert.equal(calls, 0);
    assert.deepEqual(events.list(), []);
    assert.equal(tasks.get('t').status, 'failed');
  } finally {
    raw.close();
    events.close();
    tasks.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Sandbox Audit decoder rejects completed receipts that claim another started result', async () => {
  const { buildSandboxAudit } = await import('../src/audit/sandbox.js');
  const { createEvent } = await import('../src/events/domain.js');
  const payload = {
    actorKind: 'agent',
    actorId: 'a',
    taskId: 't',
    taskVersion: 2,
    eventId: null,
    inputDigest: 'a'.repeat(64),
    proposalRef: null,
    approvalId: null,
  };
  const request = createEvent(
    { type: 'sandbox.started', source: 'sandbox:docker', payload },
    { id: 'sandbox:t:2', createdAt: '0' },
  );
  const receipt = createEvent(
    {
      type: 'sandbox.completed',
      source: 'sandbox:docker',
      payload: { ...payload, requestId: request.id, result: 'started', outputRef: null },
    },
    { id: request.id + ':completed', createdAt: '1' },
  );
  assert.throws(() => buildSandboxAudit([request, receipt]), /result/);
});

test('Sandbox rejects an invalid injected input digest before runner and Audit writes', async () => {
  const { produceSandboxArtifact } = await import('../src/sandbox/service.js');
  let calls = 0,
    writes = 0;
  const task = {
    ...createTask(
      { title: 'fixture', objective: 'verify', kind: 'execution_task' },
      { id: 't', createdAt: '0' },
    ),
    owner: 'a',
    status: 'running' as const,
    version: 2,
  };
  await assert.rejects(
    produceSandboxArtifact(
      async () => {
        calls++;
        return { reason: 'exited', exitCode: 0, stdout: 'ok', stderr: '' };
      },
      async () => 'org://artifacts/' + 'a'.repeat(64),
      { code: 'console.log(1)', writable: false, files: [], timeoutMs: 1000, maxOutputBytes: 4096 },
      () => '0',
      () => 'artifact',
      undefined,
      {
        task,
        digest: () => 'invalid',
        events: {
          publish: (event) => {
            writes++;
            return event;
          },
        },
      },
    ),
    /digest/,
  );
  assert.equal(calls, 0);
  assert.equal(writes, 0);
});

test('Sandbox result Audit storage failure retains started receipt and rejects replay of that execution version', async () => {
  const { produceSandboxArtifact } = await import('../src/sandbox/service.js');
  const home = mkdtempSync('/tmp/org-sandbox-audit-result-'),
    path = home + '/org.db';
  const tasks = new SqliteTaskProvider(path),
    events = new SqliteEventBus(path),
    raw = new Database(path);
  try {
    tasks.create(
      createTask(
        { title: 'fixture', objective: 'verify', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
    );
    tasks.update('t', { owner: 'a' }, 'assigned');
    const running = tasks.update('t', { status: 'running' }, 'running');
    raw.exec(
      "CREATE TRIGGER fail_sandbox_result BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.type')='sandbox.completed' BEGIN SELECT RAISE(ABORT,'audit result unavailable'); END;",
    );
    let calls = 0,
      saves = 0;
    const execute = () =>
      produceSandboxArtifact(
        async () => {
          calls++;
          return { reason: 'exited' as const, exitCode: 0, stdout: 'ok', stderr: '' };
        },
        async () => {
          saves++;
          return 'org://artifacts/' + 'a'.repeat(64);
        },
        {
          code: 'console.log(1)',
          writable: false,
          files: [],
          timeoutMs: 1000,
          maxOutputBytes: 4096,
        },
        () => '0',
        () => 'artifact',
        undefined,
        {
          task: running,
          events,
          digest: (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        },
      );
    await assert.rejects(execute(), /audit result unavailable/);
    assert.equal(calls, 1);
    assert.equal(saves, 1);
    const originals = events.list();
    assert.equal(originals.length, 1);
    assert.equal(originals[0]?.type, 'sandbox.started');
    raw.exec('DROP TRIGGER fail_sandbox_result');
    await assert.rejects(execute(), /immutable|UNIQUE/);
    assert.equal(calls, 1);
    assert.equal(saves, 1);
    assert.deepEqual(events.list(), originals);
    const audit = collectAudit(
      { list: () => [] },
      { capabilityHistory: () => [] },
      tasks,
      events,
    ).filter((entry) => entry.tool === 'sandbox.run');
    assert.deepEqual(
      audit.map((entry) => entry.result),
      ['started'],
    );
  } finally {
    raw.close();
    events.close();
    tasks.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Sandbox started Audit records claim time independently of earlier Runtime Task start', async () => {
  const { produceSandboxArtifact } = await import('../src/sandbox/service.js');
  const task = {
    ...createTask(
      { title: 'fixture', objective: 'verify', kind: 'execution_task' },
      { id: 't', createdAt: '2026-10-07T00:00:00.000Z' },
    ),
    owner: 'a',
    status: 'running' as const,
    version: 2,
  };
  const receipts: import('../src/events/domain.js').Event[] = [];
  const at = '2026-10-07T01:00:00.000Z';
  await produceSandboxArtifact(
    async () => ({ reason: 'exited', exitCode: 0, stdout: 'ok', stderr: '' }),
    async () => 'org://artifacts/' + 'a'.repeat(64),
    { code: 'console.log(1)', writable: false, files: [], timeoutMs: 1000, maxOutputBytes: 4096 },
    () => at,
    () => 'artifact',
    undefined,
    {
      task,
      digest: (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      events: {
        publish: (event) => {
          receipts.push(event);
          return event;
        },
      },
    },
  );
  assert.equal(receipts[0]?.createdAt, at);
  assert.equal(receipts[1]?.createdAt, at);
});
