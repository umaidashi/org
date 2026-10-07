import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test.each([
  ['success', 'content'],
  ['unknown', 'content'],
  ['stale', 'content'],
  ['success', 'fields'],
  ['unknown', 'fields'],
  ['stale', 'fields'],
] as const)(
  'native Linear Issue update freezes approved intent and baseline with fault=%s mode=%s',
  async (fault, mode) => {
    const home = mkdtempSync('/tmp/org-linear-update-'),
      db = home + '/org.db';
    const originalIssue = {
      id: '11111111-1111-4111-8111-111111111111',
      identifier: 'ORG-1',
      url: 'https://linear.app/org/issue/ORG-1/existing',
      title: 'existing',
      description: 'source',
      state: { id: '55555555-5555-4555-8555-555555555555' },
      assignee: { id: '66666666-6666-4666-8666-666666666666' } as { id: string } | null,
      labels: {
        nodes: [{ id: '77777777-7777-4777-8777-777777777777' }],
        pageInfo: { hasNextPage: false },
      },
    };
    const fields = {
      stateId: '22222222-2222-4222-8222-222222222222',
      assigneeId: null,
      labelIds: ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'],
    };
    let issue = { ...originalIssue },
      mutations = 0,
      queries = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        assert.equal(request.headers.get('Authorization'), 'fixture-update-key');
        const payload: unknown = await request.json();
        assert.ok(
          record(payload) && typeof payload.query === 'string' && record(payload.variables),
        );
        if (
          payload.query.startsWith('query KernelIssue(') ||
          payload.query.startsWith('query KernelIssueFields(')
        ) {
          queries++;
          assert.deepEqual(payload.variables, { id: issue.id });
          return Response.json({ data: { issue } });
        }
        if (mode === 'content') {
          assert.equal(
            payload.query,
            'mutation KernelIssueUpdate($id: String!, $title: String!, $description: String!) { issueUpdate(id: $id, input: { title: $title, description: $description }) { success issue { id identifier title description url } } }',
          );
          assert.deepEqual(payload.variables, {
            id: issue.id,
            title: 'approved title',
            description: '',
          });
          issue = {
            ...issue,
            title: 'approved title',
            description: '',
            url: 'https://linear.app/org/issue/ORG-1/approved-title',
          };
        } else {
          assert.ok(payload.query.startsWith('mutation KernelIssueFieldsUpdate('));
          assert.deepEqual(payload.variables, { id: issue.id, input: fields });
          issue = {
            ...issue,
            state: { id: fields.stateId },
            assignee: null,
            labels: {
              nodes: fields.labelIds.toReversed().map((id) => ({ id })),
              pageInfo: { hasNextPage: false },
            },
          };
          assert.equal(issue.title, originalIssue.title);
          assert.equal(issue.description, originalIssue.description);
        }
        mutations++;
        if (fault === 'unknown') return new Response('owned uncertainty', { status: 503 });
        return Response.json({ data: { issueUpdate: { success: true, issue } } });
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
          env: { HOME: home, PATH: process.env.PATH ?? '', LINEAR_API_KEY: 'fixture-update-key' },
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
      assert.doesNotMatch(stdout + stderr, /fixture-update-key/);
      return { code, stdout, stderr };
    };
    try {
      if (mode === 'fields' && fault === 'success') {
        const invalid = await run([
          'task',
          'request-linear-update',
          'linear:issue:' + issue.id,
          '--fields',
          '{fixture-update-key',
          '--expected-version',
          '0',
          '--actor',
          'operator',
          '--key',
          'invalid',
        ]);
        assert.equal(invalid.code, 2);
        assert.equal(existsSync(db), false);
      }
      const imported = await run(['task', 'import-linear', issue.id, '--json']);
      assert.equal(imported.code, 0, imported.stderr);
      const taskId = 'linear:issue:' + issue.id;
      const input = [
        taskId,
        ...(mode === 'content'
          ? ['--title', 'approved title', '--description', '']
          : ['--fields', JSON.stringify(fields)]),
        '--expected-version',
        '0',
        '--actor',
        'operator',
      ];
      const requested = await run([
        'task',
        'request-linear-update',
        ...input,
        '--key',
        'update',
        '--json',
      ]);
      assert.equal(requested.code, 0, requested.stderr);
      const approval: unknown = JSON.parse(requested.stdout);
      assert.ok(record(approval) && typeof approval.id === 'string');
      const approvalId = approval.id;
      assert.doesNotMatch(requested.stdout, /approved title|source/);
      const repeat = await run([
        'task',
        'request-linear-update',
        ...input,
        '--key',
        'update',
        '--json',
      ]);
      assert.equal(repeat.code, 0, repeat.stderr);
      assert.deepEqual(JSON.parse(repeat.stdout), approval);
      const apply = () =>
        run(['task', 'apply-linear-update', ...input, '--approval', approvalId, '--json']);
      const before = queries;
      assert.equal((await apply()).code, 1);
      assert.equal(queries, before);
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
        'reviewed title and description deletion',
      ]);
      assert.equal(decided.code, 0, decided.stderr);
      if (fault === 'stale')
        issue =
          mode === 'content'
            ? { ...issue, description: 'external edit' }
            : { ...issue, state: { id: '88888888-8888-4888-8888-888888888888' } };
      const results = await Promise.all([apply(), apply()]);
      assert.deepEqual(
        results
          .map((r) => {
            assert.ok(typeof r.code === 'number');
            return r.code;
          })
          .sort((a, b) => a - b),
        fault === 'success' ? [0, 1] : [1, 1],
      );
      assert.equal(mutations, fault === 'stale' ? 0 : 1);
      const beforeRetry = queries;
      assert.equal((await apply()).code, 1);
      if (fault !== 'stale') assert.equal(queries, beforeRetry);
      assert.equal(mutations, fault === 'stale' ? 0 : 1);
      const after = await run(['task', 'get', taskId, '--json']);
      assert.equal(after.code, 0, after.stderr);
      assert.deepEqual(JSON.parse(after.stdout), JSON.parse(imported.stdout));
      const observe = () =>
        run([
          'task',
          'observe-linear-update',
          taskId,
          '--actor',
          'operator',
          '--approval',
          approvalId,
          '--json',
        ]);
      const observed = await Promise.all([observe(), observe()]);
      for (const result of observed) {
        assert.equal(result.code, fault === 'stale' ? 1 : 0, result.stderr);
        if (fault !== 'stale') {
          const receipt: unknown = JSON.parse(result.stdout);
          assert.ok(record(receipt));
          assert.equal(
            receipt.type,
            fault === 'success' ? 'linear.update.updated' : 'linear.update.observed',
          );
        }
      }
      if (fault !== 'stale')
        assert.deepEqual(
          JSON.parse(observed[0]?.stdout ?? ''),
          JSON.parse(observed[1]?.stdout ?? ''),
        );
      const beforeObserveRetry = queries;
      assert.equal((await observe()).code, fault === 'stale' ? 1 : 0);
      assert.equal(queries, beforeObserveRetry);
      assert.equal(mutations, fault === 'stale' ? 0 : 1);
      const logs = await run(['logs', '--task', taskId, '--json']);
      assert.equal(logs.code, 0, logs.stderr);
      const entries: unknown = JSON.parse(logs.stdout);
      assert.ok(Array.isArray(entries));
      const last: unknown = entries.at(-1);
      assert.ok(record(last));
      assert.equal(
        last.result,
        fault === 'stale' ? 'approved' : fault === 'success' ? 'succeeded' : 'observed',
      );
      assert.doesNotMatch(logs.stdout, /approved title|external edit|source|fixture-update-key/);
      if (fault === 'success') {
        const again = await run([
          'task',
          'request-linear-update',
          ...input,
          '--key',
          'next-update',
          '--json',
        ]);
        assert.equal(again.code, 0, again.stderr);
        const refreshed = await run([
          'task',
          'refresh-linear',
          taskId,
          '--expected-version',
          '0',
          '--json',
        ]);
        assert.equal(refreshed.code, 0, refreshed.stderr);
        const current: unknown = JSON.parse(refreshed.stdout);
        assert.ok(record(current));
        assert.equal(current.title, mode === 'content' ? 'approved title' : 'existing');
        assert.equal(current.externalRef, originalIssue.url);
        assert.equal(current.version, mode === 'content' ? 1 : 0);
      }
    } finally {
      await server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  },
  20000,
);
