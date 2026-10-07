import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { cli } from './cli-path.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
import { createRoom } from '../src/rooms/domain.js';

for (const mode of ['content', 'fields'])
  for (const outcome of ['success', 'unknown', 'stale'])
    test(`Agent Linear ${mode} ${outcome} executes one approved update and recovers without replay`, async () => {
      const home = mkdtempSync('/tmp/org-task-linear-run-'),
        db = home + '/org.db';
      const id = '11111111-1111-4111-8111-111111111111',
        workId = 'linear:issue:' + id;
      const scope = home + '/scope.json',
        preload = home + '/http.ts',
        state = home + '/remote.json',
        calls = home + '/calls.txt';
      const initial = {
        id,
        identifier: 'ORG-1',
        title: 'Existing',
        description: null,
        url: 'https://linear.app/org/issue/ORG-1/existing',
        labels: { nodes: [{ id }], pageInfo: { hasNextPage: false } },
      };
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
        ...createTask(
          { title: initial.title, objective: 'Original' },
          { id: workId, createdAt: '0' },
        ),
        externalRef: initial.url,
      });
      tasks.create(
        createTask(
          { kind: 'execution_task', title: 'Update', objective: 'Propose', parentId: workId },
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
            participants: [{ kind: 'agent', id: 'owner' }],
          },
          { id: 'room', createdAt: '0' },
        ),
      );
      const changes =
        mode === 'content'
          ? { title: 'Updated', description: 'Proposed' }
          : { fields: { labelIds: [] } };
      rooms.append(
        'room',
        {
          sender: { kind: 'agent', id: 'owner' },
          content: JSON.stringify({
            version: 1,
            tool: 'linear-update',
            workItemVersion: 0,
            ...changes,
          }),
        },
        { id: 'message', createdAt: '2' },
      );
      rooms.close();
      tasks.close();
      agents.close();
      writeFileSync(
        scope,
        JSON.stringify([
          { agentId: 'owner', issueIds: [id], apiKeyEnv: 'OWNER_KEY', effect: 'write' },
        ]),
      );
      writeFileSync(state, JSON.stringify(initial));
      writeFileSync(calls, '');
      writeFileSync(
        preload,
        `import assert from 'node:assert/strict';import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!=='https://api.linear.app/graphql')return original(url,init);assert.equal(new Headers(init.headers).get('Authorization'),'fixture-owner-key');const body=JSON.parse(init.body);assert.equal(body.variables.id,${JSON.stringify(id)});let issue=JSON.parse(readFileSync(${JSON.stringify(state)},'utf8'));if(body.query.startsWith('query ')){appendFileSync(${JSON.stringify(calls)},'R');return Response.json({data:{issue}});}appendFileSync(${JSON.stringify(calls)},'W');assert.ok(body.query.startsWith('mutation '));if(${JSON.stringify(mode)}==='fields'){assert.deepEqual(body.variables,{id:${JSON.stringify(id)},input:{labelIds:[]}});issue.labels={nodes:[],pageInfo:{hasNextPage:false}};}else{assert.deepEqual(body.variables,{id:${JSON.stringify(id)},title:'Updated',description:'Proposed'});issue.title='Updated';issue.description='Proposed';}writeFileSync(${JSON.stringify(state)},JSON.stringify(issue));if(${JSON.stringify(outcome)}==='unknown')throw Error('owned lost response');return Response.json({data:{issueUpdate:{success:true,issue}}});};`,
      );
      const env = {
        ...process.env,
        ORG_LINEAR_AGENT_SCOPES: scope,
        OWNER_KEY: 'fixture-owner-key',
        LINEAR_API_KEY: 'fixture-host-key',
      };
      const args = (rest: string[]) => [
        '--no-env-file',
        '--preload',
        preload,
        cli,
        '--direct',
        '--db',
        db,
        ...rest,
      ];
      const run = (rest: string[]) =>
        spawnSync(process.execPath, args(rest), { env, encoding: 'utf8', timeout: 10000 });
      const parallel = (rest: string[]) =>
        new Promise<{ status: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(process.execPath, args(rest), { env });
            let stdout = '',
              stderr = '';
            child.stdout.on('data', (data: Buffer) => {
              stdout += data.toString();
            });
            child.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
            child.once('error', reject);
            child.once('exit', (status) => resolve({ status, stdout, stderr }));
          },
        );
      try {
        const requested = run([
          'task',
          'request-task-linear-update',
          task.id,
          '--room',
          'room',
          '--room-message',
          'message',
          '--expected-version',
          String(task.version),
          '--key',
          'update',
          '--json',
        ]);
        assert.equal(requested.status, 0, requested.stderr);
        const approval: unknown = JSON.parse(requested.stdout);
        assert.ok(
          approval &&
            typeof approval === 'object' &&
            'id' in approval &&
            typeof approval.id === 'string',
        );
        const apply = [
          'task',
          'apply-task-linear-update',
          task.id,
          '--approval',
          approval.id,
          '--json',
        ];
        const observe = [
          'task',
          'observe-task-linear-update',
          task.id,
          '--approval',
          approval.id,
          '--json',
        ];
        const pending = readFileSync(calls, 'utf8');
        assert.equal(run(apply).status, 1);
        assert.equal(readFileSync(calls, 'utf8'), pending);
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
        if (outcome === 'stale')
          writeFileSync(
            state,
            JSON.stringify({
              ...initial,
              ...(mode === 'content'
                ? { title: 'Other' }
                : { labels: { nodes: [], pageInfo: { hasNextPage: false } } }),
            }),
          );
        const results = await Promise.all([parallel(apply), parallel(apply)]);
        assert.equal(results.filter((r) => r.status === 0).length, outcome === 'success' ? 1 : 0);
        assert.equal(
          readFileSync(calls, 'utf8').split('W').length - 1,
          outcome === 'stale' ? 0 : 1,
        );
        const t = new SqliteTaskProvider(db);
        assert.equal(t.get(workId).title, initial.title);
        assert.equal(t.get(task.id).version, task.version);
        t.update(workId, { title: 'Local progress' }, '3');
        t.close();
        const observed = await Promise.all([parallel(observe), parallel(observe)]);
        if (outcome === 'stale') assert.ok(observed.every((r) => r.status === 1));
        else {
          assert.ok(
            observed.every((r) => r.status === 0),
            observed.map((r) => r.stderr).join(''),
          );
          assert.deepEqual(
            JSON.parse(observed[0]?.stdout ?? ''),
            JSON.parse(observed[1]?.stdout ?? ''),
          );
          const before = readFileSync(calls, 'utf8');
          assert.equal(run(observe).status, 0);
          assert.equal(run(apply).status, 1);
          assert.equal(readFileSync(calls, 'utf8'), before);
          const logs = run(['logs', '--task', workId, '--json']);
          assert.equal(logs.status, 0, logs.stderr);
          assert.doesNotMatch(
            logs.stdout + observed.map((r) => r.stdout).join(''),
            /fixture-owner-key|fixture-host-key|Proposed|Updated/,
          );
          const entries: unknown = JSON.parse(logs.stdout);
          assert.ok(Array.isArray(entries));
          assert.ok(
            entries.some(
              (e: { result: string; actor: { kind: string; id: string } }) =>
                e.result === (outcome === 'success' ? 'succeeded' : 'observed') &&
                e.actor.kind === 'agent' &&
                e.actor.id === 'owner',
            ),
          );
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }, 20000);
