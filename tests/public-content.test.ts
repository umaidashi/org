import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { checkPublicFiles } from '../scripts/public-content.js';

test('public content gate rejects credential files and secret values without disclosing them', () => {
  const secret = 'test-secret-value-that-must-stay-private';
  for (const file of [
    { path: '.env', body: 'X=value' },
    { path: 'nested/.env.production', body: 'X=value' },
    { path: 'docs/log.txt', body: `Log: ${secret}` },
  ]) {
    assert.throws(
      () => checkPublicFiles([file], [secret]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
  }
  assert.doesNotThrow(() =>
    checkPublicFiles([{ path: '.env.example', body: 'TYPESAFE_API_KEY=' }], []),
  );
});
