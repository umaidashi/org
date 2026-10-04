import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent, changeReportingLine } from '../src/agents/domain.js';
import { setReportingLine } from '../src/agents/service.js';
const root = createAgent(
  { name: 'chief', role: 'Chief', runtime: 'claude' },
  { id: 'chief', createdAt: 'before' },
);
const worker = createAgent(
  { name: 'cto', role: 'CTO', runtime: 'codex' },
  { id: 'cto', createdAt: 'before' },
);
test('reporting line preserves identity and rejects missing managers and direct or indirect cycles', () => {
  const changed = changeReportingLine([root, worker], worker.id, root.id);
  assert.deepEqual(changed, { ...worker, reportsTo: root.id });
  assert.deepEqual(changeReportingLine([root, changed], worker.id, null), worker);
  assert.deepEqual(worker, {
    id: 'cto',
    name: 'cto',
    role: 'CTO',
    runtime: 'codex',
    createdAt: 'before',
  });
  assert.throws(() => changeReportingLine([root, worker], 'missing', root.id), /not found/);
  assert.throws(() => changeReportingLine([root, worker], worker.id, 'missing'), /not found/);
  assert.throws(() => changeReportingLine([root, worker], worker.id, worker.id), /cycle/);
  assert.throws(() => changeReportingLine([root, changed], root.id, worker.id), /cycle/);
  assert.throws(() =>
    createAgent(
      { name: 'x', role: 'x', runtime: 'codex', reportsTo: ' ' },
      { id: 'x', createdAt: 'before' },
    ),
  );
});
test('reporting line service rejects invalid graph before writing and uses the injected timestamp', () => {
  let writes = 0;
  const writer = {
    list: () => [root, worker],
    setReportsTo: (id: string, manager: string | null, at: string) => {
      writes++;
      assert.equal(id, worker.id);
      assert.equal(manager, root.id);
      assert.equal(at, 'changed');
      return { ...worker, reportsTo: root.id };
    },
  };
  assert.throws(() => setReportingLine(writer, worker.id, 'missing', 'changed'));
  assert.equal(writes, 0);
  assert.equal(setReportingLine(writer, worker.id, root.id, 'changed').reportsTo, root.id);
  assert.equal(writes, 1);
  assert.throws(
    () =>
      setReportingLine(
        {
          ...writer,
          setReportsTo: () => {
            throw new Error('storage failure');
          },
        },
        worker.id,
        root.id,
        'changed',
      ),
    /storage failure/,
  );
});
