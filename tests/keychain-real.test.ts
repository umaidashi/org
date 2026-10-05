import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { KeychainSecretStore } from '../src/secrets/keychain.js';
import { configuredWorkflowRuntime } from '../src/workflows/cli.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test.skipIf(process.platform !== 'darwin' || process.env.ORG_KEYCHAIN_TEST !== '1')(
  'native private macOS Keychain swaps host and Agent Workflow credentials without env, output leakage or existing item changes',
  async () => {
    const home = mkdtempSync('/tmp/org-keychain-real-test-');
    chmodSync(home, 0o700);
    const path = home + '/proof.keychain-db',
      password = randomBytes(32).toString('hex'),
      hostKey = randomBytes(32).toString('hex'),
      agentKey = randomBytes(32).toString('hex'),
      service = 'org-private-proof';
    let created = false,
      server: ReturnType<typeof Bun.serve> | undefined;
    const security = (args: string[]): string => {
      const r = spawnSync('/usr/bin/security', args, {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 65536,
      });
      assert.ok(r.status === 0, 'Private Keychain operation failed');
      return r.stdout;
    };
    const before = security(['list-keychains', '-d', 'user']);
    try {
      security(['create-keychain', '-p', password, path]);
      created = true;
      chmodSync(path, 0o600);
      for (const [account, value] of [
        ['host', hostKey],
        ['agent-a', agentKey],
      ]) {
        assert.ok(account && value);
        security([
          'add-generic-password',
          '-a',
          account,
          '-s',
          service,
          '-w',
          value,
          '-T',
          '/usr/bin/security',
          path,
        ]);
      }
      const location = { path, service, account: 'host' },
        agentLocation = { path, service, account: 'agent-a' };
      const store = new KeychainSecretStore([
        { actorId: 'host:workflow', reference: 'n8n-api-key', ...location },
        { actorId: 'agent-a', reference: 'n8n-api-key', ...agentLocation },
      ]);
      assert.ok(store.getSecret('host:workflow', 'n8n-api-key') === hostKey);
      assert.ok(store.getSecret('agent-a', 'n8n-api-key') === agentKey);
      assert.throws(() => store.getSecret('agent-b', 'n8n-api-key'), /denied/);
      const file = readFileSync(path);
      assert.ok(!file.includes(Buffer.from(hostKey)) && !file.includes(Buffer.from(agentKey)));
      let invokes = 0;
      const headers: string[] = [];
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request) => {
          if (new URL(request.url).pathname === '/webhook/check') {
            assert.equal(request.headers.get('X-N8N-API-KEY'), null);
            assert.deepEqual(await request.json(), {});
            invokes++;
            return Response.json({ executionId: '13' });
          }
          const key = request.headers.get('X-N8N-API-KEY');
          assert.ok(key === hostKey || key === agentKey, 'Unexpected native API credential');
          headers.push(key);
          return Response.json({ id: '13', workflowId: 'flow', status: 'success' });
        },
      });
      const config = home + '/workflow.json';
      writeFileSync(
        config,
        JSON.stringify({
          baseUrl: `http://127.0.0.1:${server.port}`,
          apiKeyKeychain: location,
          workflows: [{ id: 'flow', path: 'check' }],
          agentScopes: [
            {
              agentId: 'agent-a',
              workflowIds: ['flow'],
              apiKeyKeychain: agentLocation,
              effect: 'read_only',
            },
          ],
        }),
        { mode: 0o600 },
      );
      const child = spawn(process.execPath, [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        home + '/org.db',
        'workflow',
        'run',
        'flow',
        '--key',
        'keychain-proof',
        '--config',
        config,
        '--json',
      ]);
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (v) => (stdout += v));
      child.stderr.on('data', (v) => (stderr += v));
      const status = await new Promise((r) => child.once('exit', r));
      assert.ok(status === 0, 'Keychain Workflow CLI failed');
      assert.ok(
        ![hostKey, agentKey, password].some((key) => (stdout + stderr).includes(key)),
        'Credential output denied',
      );
      const receipt: unknown = JSON.parse(stdout);
      assert.ok(record(receipt) && record(receipt.payload));
      assert.equal(receipt.payload.executionId, '13');
      const configured = await configuredWorkflowRuntime(config);
      assert.throws(() => configured.agentRuntime('agent-b', 'flow'), /denied/);
      assert.equal(await configured.agentRuntime('agent-a', 'flow').invoke('flow', {}), '13');
      assert.equal(invokes, 2);
      assert.ok(headers.includes(hostKey) && headers.includes(agentKey));
    } finally {
      await server?.stop(true);
      if (created) security(['delete-keychain', path]);
      assert.ok(
        security(['list-keychains', '-d', 'user']) === before,
        'Existing user search list changed',
      );
      rmSync(home, { recursive: true, force: true });
    }
  },
  20000,
);
