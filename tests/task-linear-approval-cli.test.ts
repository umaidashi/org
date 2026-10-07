import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cli } from './cli-path.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
import { createRoom } from '../src/rooms/domain.js';

for (const mode of ['content', 'fields'])
  test(`Task owner Linear ${mode} proposal persists Agent approval through human decision and cannot use human apply`, () => {
    const home = mkdtempSync('/tmp/org-task-linear-'),
      db = home + '/org.db';
    const issueId = '11111111-1111-4111-8111-111111111111',
      workId = 'linear:issue:' + issueId;
    const scope = home + '/scope.json',
      preload = home + '/http.ts',
      calls = home + '/calls.txt';
    const agents = new SqliteAgentRepository(db),
      tasks = new SqliteTaskProvider(db),
      rooms = new SqliteRoomRepository(db);
    agents.insert(
      createAgent(
        {
          name: 'Worker',
          role: 'worker',
          runtime: 'claude',
          capabilities: ['can_read', 'can_write', 'can_access_network', 'can_contact_external'],
        },
        { id: 'owner', createdAt: '0' },
      ),
    );
    tasks.create({
      ...createTask({ title: 'Existing', objective: 'Existing' }, { id: workId, createdAt: '0' }),
      externalRef: 'https://linear.app/org/issue/ORG-1/existing',
    });
    tasks.create(
      createTask(
        { kind: 'execution_task', title: 'Update', objective: 'Propose update', parentId: workId },
        { id: 'execution', createdAt: '0' },
      ),
    );
    const task = tasks.update('execution', { owner: 'owner' }, '1');
    rooms.create(
      createRoom(
        {
          title: 'Task',
          type: 'task',
          taskId: task.id,
          participants: [
            { kind: 'agent', id: 'owner' },
            { kind: 'human', id: 'operator' },
          ],
        },
        { id: 'room', createdAt: '0' },
      ),
    );
    rooms.append(
      'room',
      {
        sender: { kind: 'agent', id: 'owner' },
        content: JSON.stringify({
          version: 1,
          tool: 'linear-update',
          workItemVersion: 0,
          ...(mode === 'content'
            ? { title: 'Changed', description: 'Proposed' }
            : { fields: { labelIds: [] } }),
        }),
      },
      { id: 'proposal', createdAt: '2' },
    );
    rooms.append(
      'room',
      {
        sender: { kind: 'human', id: 'operator' },
        content: JSON.stringify({
          version: 1,
          tool: 'linear-update',
          workItemVersion: 0,
          title: 'Changed',
          description: 'Proposed',
        }),
      },
      { id: 'human-proposal', createdAt: '2' },
    );
    rooms.close();
    tasks.close();
    agents.close();
    writeFileSync(
      scope,
      JSON.stringify([
        { agentId: 'owner', issueIds: [issueId], apiKeyEnv: 'OWNER_LINEAR_KEY', effect: 'write' },
      ]),
    );
    writeFileSync(calls, '');
    writeFileSync(
      preload,
      `import assert from 'node:assert/strict';import {appendFileSync} from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!=='https://api.linear.app/graphql')return original(url,init);assert.equal(new Headers(init.headers).get('Authorization'),'fixture-owner-key');const body=JSON.parse(init.body);assert.ok(body.query.startsWith('query '));assert.deepEqual(body.variables,{id:${JSON.stringify(issueId)}});appendFileSync(${JSON.stringify(calls)},'read;');return Response.json({data:{issue:{id:${JSON.stringify(issueId)},identifier:'ORG-1',title:'Existing',description:null,url:'https://linear.app/org/issue/ORG-1/existing',labels:{nodes:[],pageInfo:{hasNextPage:false}}}}});};`,
    );
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        ['--no-env-file', '--preload', preload, cli, '--direct', '--db', db, ...args],
        {
          encoding: 'utf8',
          timeout: 10000,
          env: {
            ...process.env,
            ORG_LINEAR_AGENT_SCOPES: scope,
            OWNER_LINEAR_KEY: 'fixture-owner-key',
            LINEAR_API_KEY: 'fixture-host-key',
          },
        },
      );
    const request = (version = String(task.version), message = 'proposal', key = 'task-update') =>
      run([
        'task',
        'request-task-linear-update',
        task.id,
        '--room',
        'room',
        '--room-message',
        message,
        '--expected-version',
        version,
        '--key',
        key,
        '--json',
      ]);
    try {
      const result = request();
      assert.equal(result.status, 0, result.stderr);
      const approval: unknown = JSON.parse(result.stdout);
      assert.ok(
        approval &&
          typeof approval === 'object' &&
          'id' in approval &&
          typeof approval.id === 'string' &&
          'actor' in approval &&
          'taskId' in approval &&
          'operation' in approval,
      );
      assert.ok(
        approval.operation &&
          typeof approval.operation === 'object' &&
          'binding' in approval.operation &&
          'kind' in approval.operation,
      );
      assert.deepEqual(approval.actor, { kind: 'agent', id: 'owner' });
      assert.equal(approval.taskId, workId);
      assert.deepEqual(approval.operation.binding, {
        taskId: task.id,
        taskVersion: task.version,
        proposalRef: 'org://rooms/room/messages/proposal',
      });
      assert.equal(approval.operation.kind, 'linear_issue_update');
      if (mode === 'fields') {
        assert.ok('fields' in approval.operation);
        assert.deepEqual(approval.operation.fields, ['labelIds']);
      } else assert.equal('fields' in approval.operation, false);
      assert.deepEqual(JSON.parse(request().stdout), approval);
      const pending = run(['approval', 'get', approval.id, '--json']);
      assert.equal(JSON.parse(pending.stdout).decision, null);
      const decision = run([
        'approval',
        'decide',
        approval.id,
        '--actor',
        'reviewer',
        '--decision',
        'approve',
        '--reason',
        'Verified',
        '--json',
      ]);
      assert.equal(decision.status, 0, decision.stderr);
      assert.deepEqual(JSON.parse(decision.stdout).request, approval);
      const rejectedRequest = request(String(task.version), 'proposal', 'rejected');
      assert.equal(rejectedRequest.status, 0, rejectedRequest.stderr);
      const rejectId: unknown = JSON.parse(rejectedRequest.stdout).id;
      assert.equal(typeof rejectId, 'string');
      assert.ok(typeof rejectId === 'string');
      const rejected = run([
        'approval',
        'decide',
        rejectId,
        '--actor',
        'reviewer',
        '--decision',
        'reject',
        '--reason',
        'Declined',
        '--json',
      ]);
      assert.equal(rejected.status, 0, rejected.stderr);
      assert.equal(
        JSON.parse(run(['approval', 'get', rejectId, '--json']).stdout).decision.decision,
        'reject',
      );
      const before = readFileSync(calls, 'utf8');
      const apply = run([
        'task',
        'apply-linear-update',
        workId,
        '--actor',
        'owner',
        '--expected-version',
        '0',
        '--title',
        'Changed',
        '--description',
        'Proposed',
        '--approval',
        approval.id,
      ]);
      assert.equal(apply.status, 1);
      assert.equal(readFileSync(calls, 'utf8'), before);
      for (const failure of [
        request('0'),
        request(String(task.version), 'human-proposal'),
        request(String(task.version), 'missing'),
      ])
        assert.equal(failure.status, 1, failure.stderr);
      assert.equal(readFileSync(calls, 'utf8'), before);
      writeFileSync(
        scope,
        JSON.stringify([{ agentId: 'owner', issueIds: [issueId], apiKeyEnv: 'OWNER_LINEAR_KEY' }]),
      );
      assert.equal(request(String(task.version), 'proposal', 'readonly').status, 1);
      assert.equal(readFileSync(calls, 'utf8'), before);
      const logs = run(['logs', '--task', workId, '--json']);
      assert.equal(logs.status, 0, logs.stderr);
      const entries: unknown = JSON.parse(logs.stdout);
      assert.ok(Array.isArray(entries));
      assert.ok(
        entries.some(
          (entry: { actor: { kind: string; id: string } }) =>
            entry.actor.kind === 'agent' && entry.actor.id === 'owner',
        ),
      );
      assert.doesNotMatch(
        result.stdout + logs.stdout + apply.stderr,
        /fixture-owner-key|fixture-host-key|Changed|Proposed/,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
