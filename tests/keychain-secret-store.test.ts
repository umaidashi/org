import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { KeychainSecretStore } from '../src/secrets/keychain.js';
test('Keychain grant denies unknown actor before native lookup, bounds credentials and redacts failures', () => {
  const grant = {
    actorId: 'agent-a',
    reference: 'n8n-api-key',
    path: '/private/tmp/proof.keychain-db',
    service: 'org-proof',
    account: 'agent-a',
  };
  let calls = 0;
  const store = new KeychainSecretStore([grant], (location) => {
    calls++;
    assert.equal(location.account, 'agent-a');
    return 'PRIVATE_SECRET';
  });
  assert.throws(() => store.getSecret('agent-b', 'n8n-api-key'), /access denied/);
  assert.throws(() => store.getSecret('agent-a', 'other'), /access denied/);
  assert.equal(calls, 0);
  grant.account = 'changed';
  assert.equal(store.getSecret('agent-a', 'n8n-api-key'), 'PRIVATE_SECRET');
  assert.equal(calls, 1);
  for (const lookup of [
    () => {
      throw new Error('PRIVATE_SECRET');
    },
    () => '',
    () => 'x'.repeat(65537),
    () => 'bad\0secret',
  ]) {
    assert.throws(
      () =>
        new KeychainSecretStore([{ ...grant, account: 'agent-a' }], lookup).getSecret(
          'agent-a',
          'n8n-api-key',
        ),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Secret unavailable');
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
  assert.throws(() => new KeychainSecretStore([grant, grant]), /Duplicate/);
  for (const invalid of [
    { ...grant, path: 'relative' },
    { ...grant, path: '/tmp/bad\0path' },
    { ...grant, service: '' },
    { ...grant, account: '-w' },
    { ...grant, reference: 'invalid ref' },
  ])
    assert.throws(() => new KeychainSecretStore([invalid]), /Invalid/);
});
