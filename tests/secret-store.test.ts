import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { EnvironmentSecretStore } from '../src/secrets/environment.js';

test('SecretStore reads only explicit actor grants and never exposes lookup errors or mutable caller grants', () => {
  const grants = [
    { actorId: 'agent-a', reference: 'workflow-key', environmentVariable: 'ORG_WORKFLOW_KEY' },
  ];
  const reads: string[] = [];
  const store = new EnvironmentSecretStore(grants, (name) => {
    reads.push(name);
    return 'PRIVATE_FIXTURE_VALUE';
  });
  const grant = grants[0];
  assert.ok(grant);
  grant.actorId = 'agent-b';
  assert.throws(() => store.getSecret('agent-b', 'workflow-key'), /Secret access denied/);
  assert.throws(() => store.getSecret('agent-a', 'other'), /Secret access denied/);
  assert.deepEqual(reads, []);
  assert.equal(store.getSecret('agent-a', 'workflow-key'), 'PRIVATE_FIXTURE_VALUE');
  assert.deepEqual(reads, ['ORG_WORKFLOW_KEY']);
  const failing = new EnvironmentSecretStore(
    [{ actorId: 'agent-a', reference: 'key', environmentVariable: 'ORG_WORKFLOW_KEY' }],
    () => {
      throw new Error('PRIVATE_LOOKUP_ERROR');
    },
  );
  assert.throws(
    () => failing.getSecret('agent-a', 'key'),
    (error) => error instanceof Error && error.message === 'Secret unavailable',
  );
  assert.throws(
    () => new EnvironmentSecretStore([grant, grant], () => 'value'),
    /Duplicate secret grant/,
  );
  assert.throws(
    () =>
      new EnvironmentSecretStore(
        [{ actorId: 'a', reference: 'key', environmentVariable: 'BAD NAME' }],
        () => 'value',
      ),
    /Invalid secret grant/,
  );
});

test('SecretStore rejects unavailable or oversized values without returning secret content', () => {
  const grants = [{ actorId: 'a', reference: 'key', environmentVariable: 'ORG_WORKFLOW_KEY' }];
  for (const value of [undefined, '', 'PRIVATE\0VALUE', 'x'.repeat(65537)]) {
    const store = new EnvironmentSecretStore(grants, () => value);
    assert.throws(
      () => store.getSecret('a', 'key'),
      (error) => error instanceof Error && error.message === 'Secret unavailable',
    );
  }
});
