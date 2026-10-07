import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { SqliteEventBus } from '../src/events/sqlite.js';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test.each(['success', 'unknown', 'claim-failure', 'receipt-failure'])(
  'native approved Linear Artifact link preserves one mutation and originals with fault=%s',
  async (fault) => {
    const home = mkdtempSync('/tmp/org-linear-artifact-'),
      db = home + '/org.db';
    const issue = {
      id: '11111111-1111-4111-8111-111111111111',
      identifier: 'ORG-1',
      title: 'existing',
      description: 'source',
      url: 'https://linear.app/org/issue/ORG-1/existing',
    };
    const taskId = 'linear:issue:' + issue.id,
      uri = 'https://github.com/example/repo/pull/1';
    let mutations = 0;
    let observations = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        assert.equal(request.headers.get('Authorization'), 'fixture-artifact-key');
        const payload: unknown = await request.json();
        assert.ok(
          record(payload) && typeof payload.query === 'string' && record(payload.variables),
        );
        if (payload.query.startsWith('query KernelIssue('))
          return Response.json({ data: { issue } });
        if (payload.query.startsWith('query KernelArtifactStatus(')) {
          observations++;
          assert.equal(
            payload.query,
            'query KernelArtifactStatus($issueId: String!, $url: String!) { issue(id: $issueId) { id attachments(filter: { url: { eq: $url } }, first: 2) { nodes { id title url issue { id } } pageInfo { hasNextPage } } } }',
          );
          assert.deepEqual(payload.variables, { issueId: issue.id, url: uri });
          return Response.json({
            data: {
              issue: {
                id: issue.id,
                attachments: {
                  nodes: [
                    {
                      id: '22222222-2222-4222-8222-222222222222',
                      title: 'Reviewed artifact',
                      url: uri,
                      issue: { id: issue.id },
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          });
        }
        assert.equal(
          payload.query,
          'mutation KernelArtifact($issueId: String!, $title: String!, $url: String!) { attachmentCreate(input: { issueId: $issueId, title: $title, url: $url }) { success attachment { id title url issue { id } } } }',
        );
        assert.deepEqual(payload.variables, {
          issueId: issue.id,
          title: 'Reviewed artifact',
          url: uri,
        });
        mutations++;
        if (fault === 'unknown') return new Response('owned uncertainty', { status: 503 });
        return Response.json({
          data: {
            attachmentCreate: {
              success: true,
              attachment: {
                id: '22222222-2222-4222-8222-222222222222',
                title: 'Reviewed artifact',
                url: uri,
                issue: { id: issue.id },
              },
            },
          },
        });
      },
    });
    writeFileSync(
      home + '/preload.ts',
      `const original=globalThis.fetch;globalThis.fetch=(url,init)=>{if(url!=="https://api.linear.app/graphql")throw Error("unexpected endpoint");return original(${JSON.stringify('http://127.0.0.1:' + server.port)},init)};`,
    );
    const run = async (args: string[]) => {
      const child = spawn(
        process.execPath,
        ['--no-env-file', '--preload', home + '/preload.ts', cli, '--direct', '--db', db, ...args],
        {
          env: { HOME: home, PATH: process.env.PATH ?? '', LINEAR_API_KEY: 'fixture-artifact-key' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (b: Buffer) => {
        stdout += b.toString();
      });
      child.stderr.on('data', (b: Buffer) => {
        stderr += b.toString();
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      let code: number | null;
      try {
        code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        });
      } finally {
        clearTimeout(timer);
      }
      assert.doesNotMatch(stdout + stderr, /fixture-artifact-key/);
      return { code, stdout, stderr };
    };
    try {
      const imported = await run(['task', 'import-linear', issue.id]);
      assert.equal(imported.code, 0, imported.stderr);
      const linked = await run([
        'task',
        'artifact',
        taskId,
        '--artifact',
        'published',
        '--uri',
        uri,
        '--direction',
        'output',
      ]);
      assert.equal(linked.code, 0, linked.stderr);
      const original = await run(['task', 'get', taskId, '--json']);
      assert.equal(original.code, 0, original.stderr);
      const originalArtifacts = await run(['task', 'artifacts', taskId, '--json']);
      assert.equal(originalArtifacts.code, 0, originalArtifacts.stderr);
      const requestArgs = [
        'task',
        'request-linear-artifact',
        taskId,
        '--artifact',
        'published',
        '--title',
        'Reviewed artifact',
        '--expected-version',
        '1',
        '--actor',
        'operator',
        '--key',
        'link',
        '--json',
      ];
      const requested = await run(requestArgs);
      assert.equal(requested.code, 0, requested.stderr);
      const approval: unknown = JSON.parse(requested.stdout);
      assert.ok(record(approval) && typeof approval.id === 'string');
      const approvalId = approval.id;
      const repeated = await run(requestArgs);
      assert.equal(repeated.code, 0, repeated.stderr);
      assert.deepEqual(JSON.parse(repeated.stdout), approval);
      const apply = (title = 'Reviewed artifact', actor = 'operator') =>
        run([
          'task',
          'apply-linear-artifact',
          taskId,
          '--artifact',
          'published',
          '--title',
          title,
          '--expected-version',
          '1',
          '--actor',
          actor,
          '--approval',
          approvalId,
          '--json',
        ]);
      assert.equal((await apply()).code, 1);
      assert.equal(mutations, 0);
      const decided = await run([
        'approval',
        'decide',
        approvalId,
        '--actor',
        'reviewer',
        '--decision',
        'approve',
        '--reason',
        'link and existing title update reviewed',
      ]);
      assert.equal(decided.code, 0, decided.stderr);
      assert.equal((await apply('changed')).code, 1);
      assert.equal((await apply('Reviewed artifact', 'other')).code, 1);
      assert.equal(mutations, 0);
      const events = new SqliteEventBus(db);
      events.close();
      if (fault.endsWith('failure')) {
        const raw = new Database(db);
        try {
          raw.run(
            `CREATE TRIGGER owned_artifact_fault BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.type')='${fault === 'claim-failure' ? 'linear.artifact.claimed' : 'linear.artifact.linked'}' BEGIN SELECT RAISE(ABORT,'owned fault'); END`,
          );
        } finally {
          raw.close();
        }
      }
      const applied = await Promise.all([apply(), apply()]);
      assert.deepEqual(
        applied
          .map((result) => {
            assert.ok(typeof result.code === 'number');
            return result.code;
          })
          .sort((a, b) => a - b),
        fault === 'success' ? [0, 1] : [1, 1],
      );
      assert.equal(mutations, fault === 'claim-failure' ? 0 : 1);
      if (fault.endsWith('failure')) {
        const raw = new Database(db);
        try {
          raw.run('DROP TRIGGER owned_artifact_fault');
        } finally {
          raw.close();
        }
      }
      if (fault === 'claim-failure') {
        const repaired = await apply();
        assert.equal(repaired.code, 0, repaired.stderr);
      }
      assert.equal((await apply()).code, 1);
      assert.equal(mutations, 1);
      const after = await run(['task', 'get', taskId, '--json']);
      assert.equal(after.code, 0, after.stderr);
      assert.equal(after.stdout, original.stdout);
      const artifacts = await run(['task', 'artifacts', taskId, '--json']);
      assert.equal(artifacts.stdout, originalArtifacts.stdout);
      const logs = await run(['logs', '--task', taskId, '--json']);
      assert.equal(logs.code, 0, logs.stderr);
      const audit: unknown = JSON.parse(logs.stdout);
      assert.ok(Array.isArray(audit));
      assert.deepEqual(
        audit.map((entry: unknown) => {
          assert.ok(record(entry));
          return entry.tool;
        }),
        ['linear.artifact.request', 'approval.decide', 'linear.artifact', 'linear.artifact'],
      );
      const last: unknown = audit.at(-1);
      assert.ok(record(last));
      assert.equal(
        last.result,
        fault === 'success' || fault === 'claim-failure' ? 'succeeded' : 'unconfirmed',
      );
      assert.doesNotMatch(logs.stdout, /Reviewed artifact|fixture-artifact-key/);
      const observe = () =>
        run([
          'task',
          'observe-linear-artifact',
          taskId,
          '--title',
          'Reviewed artifact',
          '--actor',
          'operator',
          '--approval',
          approvalId,
          '--json',
        ]);
      const observed = await observe();
      assert.equal(observed.code, 0, observed.stderr);
      assert.equal(observations, fault === 'unknown' || fault === 'receipt-failure' ? 1 : 0);
      const reopened = await observe();
      assert.equal(reopened.code, 0, reopened.stderr);
      assert.equal(reopened.stdout, observed.stdout);
      assert.equal(observations, fault === 'unknown' || fault === 'receipt-failure' ? 1 : 0);
      assert.equal((await apply()).code, 1);
      assert.equal(mutations, 1);
      assert.equal((await run(['task', 'get', taskId, '--json'])).stdout, original.stdout);
      assert.equal(
        (await run(['task', 'artifacts', taskId, '--json'])).stdout,
        originalArtifacts.stdout,
      );
      const recoveredLogs = await run(['logs', '--task', taskId, '--json']);
      const recovered: unknown = JSON.parse(recoveredLogs.stdout);
      assert.ok(Array.isArray(recovered));
      const terminal: unknown = recovered.at(-1);
      assert.ok(record(terminal));
      assert.equal(terminal.result, 'succeeded');
    } finally {
      await server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  },
  20000,
);
