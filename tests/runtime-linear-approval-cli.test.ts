import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
import { createRoom } from '../src/rooms/domain.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

for (const mode of ['content', 'fields'])
  for (const outcome of [
    'success',
    'approval-save',
    'task-save',
    'invalid',
    'ambiguous',
    'resume',
    'unknown',
    'artifact',
    'stage',
    'claim',
    'receipt',
    'blocked',
    'crash',
  ])
    test(`native Runtime Linear ${mode} ${outcome} preserves approval, one-send and restart boundaries`, async () => {
      const continuing = [
        'resume',
        'unknown',
        'artifact',
        'stage',
        'claim',
        'receipt',
        'blocked',
        'crash',
      ].includes(outcome);
      const home = mkdtempSync('/tmp/org-runtime-linear-'),
        db = home + '/org.db',
        socket = home + '/org.sock';
      const issueId = '11111111-1111-4111-8111-111111111111',
        workId = 'linear:issue:' + issueId;
      const scope = home + '/scope.json',
        preload = home + '/http.ts',
        driver = home + '/driver.ts';
      const runtime = home + '/runtime.json',
        calls = home + '/calls.txt',
        remote = home + '/remote.json',
        turns = home + '/turns.txt';
      const issue = {
        id: issueId,
        identifier: 'ORG-1',
        title: 'Existing',
        description: null,
        url: 'https://linear.app/org/issue/ORG-1/existing',
        labels: { nodes: [], pageInfo: { hasNextPage: false } },
      };
      const proposal = {
        version: 1,
        tool: outcome === 'invalid' ? 'invalid' : 'linear-update',
        workItemVersion: 0,
        ...(mode === 'content'
          ? { title: 'Updated', description: 'Proposed' }
          : { fields: { labelIds: [] } }),
      };
      const agents = new SqliteAgentRepository(db),
        tasks = new SqliteTaskProvider(db),
        rooms = new SqliteRoomRepository(db);
      agents.insert(
        createAgent(
          {
            name: 'Worker',
            role: 'worker',
            runtime: 'codex',
            capabilities: [
              'can_read',
              'can_write',
              'can_access_network',
              'can_contact_external',
              'can_run_shell',
            ],
          },
          { id: 'owner', createdAt: '0' },
        ),
      );
      tasks.create({
        ...createTask({ title: 'Existing', objective: 'Original' }, { id: workId, createdAt: '0' }),
        externalRef: issue.url,
      });
      tasks.create(
        createTask(
          { kind: 'execution_task', title: 'Update', objective: 'Propose', parentId: workId },
          { id: 'execution', createdAt: '0' },
        ),
      );
      tasks.update('execution', { owner: 'owner' }, '1');
      const room = createRoom(
        {
          title: 'Task',
          type: 'task',
          taskId: 'execution',
          participants: [
            { kind: 'agent', id: 'owner' },
            { kind: 'human', id: 'founder' },
          ],
        },
        { id: 'room', createdAt: '0' },
      );
      rooms.create(room);
      rooms.append(
        room.id,
        { sender: { kind: 'human', id: 'founder' }, content: 'Propose an update' },
        { id: 'input', createdAt: '0' },
      );
      rooms.close();
      tasks.close();
      agents.close();
      writeFileSync(
        scope,
        JSON.stringify([
          { agentId: 'owner', issueIds: [issueId], apiKeyEnv: 'OWNER_KEY', effect: 'write' },
        ]),
      );
      writeFileSync(
        home + '/sandbox.json',
        JSON.stringify({ writable: false, files: [], timeoutMs: 1000, maxOutputBytes: 4096 }),
      );
      writeFileSync(remote, JSON.stringify(issue));
      writeFileSync(calls, '');
      writeFileSync(turns, '');
      writeFileSync(
        preload,
        `const original=globalThis.fetch;globalThis.fetch=async (url,init)=>{if(String(url)!=='https://api.linear.app/graphql')return original(url,init);if(init.headers.Authorization!=='fixture-agent-key')throw new Error('Wrong key');const body=JSON.parse(init.body),path=${JSON.stringify(calls)};let issue=await Bun.file(${JSON.stringify(remote)}).json();if(body.query.includes('mutation')){if(!${continuing})throw new Error('Unapproved mutation');if(body.variables.id!==issue.id)throw new Error('Wrong Issue');const values=body.variables.input??{title:body.variables.title,description:body.variables.description};issue={...issue,...values,...('labelIds' in values?{labels:{nodes:values.labelIds.map(id=>({id})),pageInfo:{hasNextPage:false}}}:{})};await Bun.write(${JSON.stringify(remote)},JSON.stringify(issue));await Bun.write(path,await Bun.file(path).text()+'W');if(${JSON.stringify(outcome)}==='crash')await new Promise(resolve=>setTimeout(resolve,60000));if(${JSON.stringify(outcome)}==='unknown'||${JSON.stringify(outcome)}==='blocked')throw new Error('fixture lost response');return Response.json({data:{issueUpdate:{success:true,issue}}});}await Bun.write(path,await Bun.file(path).text()+'R');return Response.json({data:{issue}});};`,
      );
      writeFileSync(
        driver,
        `#!${process.execPath}\nconst input=JSON.parse(await Bun.stdin.text());if(process.env.OWNER_KEY||process.env.LINEAR_API_KEY)throw new Error('Credential leaked');const prompt=JSON.stringify(input);const proposing=prompt.includes('linear-update');if(proposing&&!prompt.includes('workItemVersion'))throw new Error('Missing scoped instruction');await Bun.write(${JSON.stringify(turns)},await Bun.file(${JSON.stringify(turns)}).text()+'T');console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:proposing?${JSON.stringify(JSON.stringify(proposal))}:'Ready'}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
        { mode: 0o700 },
      );
      writeFileSync(
        runtime,
        JSON.stringify({
          codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
        }),
      );
      const env = {
        ...process.env,
        OWNER_KEY: 'fixture-agent-key',
        LINEAR_API_KEY: 'wrong-host-key',
        ORG_LINEAR_AGENT_SCOPES: scope,
      };
      const raw = async (args: string[]) => {
        const child = spawn(
          process.execPath,
          [
            '--no-env-file',
            cli,
            '--db',
            db,
            ...(args.includes('--direct') ? [] : ['--socket', socket]),
            ...args,
          ],
          { env },
        );
        let out = '',
          err = '';
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          err += chunk.toString();
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
        const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
        clearTimeout(timer);
        return { code, out, err };
      };
      const run = async (args: string[]): Promise<unknown> => {
        const result = await raw([...args, '--json']);
        assert.equal(result.code, 0, result.err);
        return JSON.parse(result.out);
      };
      const entity = async (args: string[]) => {
        const value = await run(args);
        assert.ok(record(value));
        return value;
      };
      let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<number | null> | undefined;
      const start = async () => {
        daemon = spawn(
          process.execPath,
          [
            '--no-env-file',
            '--preload',
            preload,
            cli,
            '--db',
            db,
            'daemon',
            '--socket',
            socket,
            '--runtime-config',
            runtime,
            '--linear-updates',
            ...(outcome === 'ambiguous' ? ['--sandbox-config', home + '/sandbox.json'] : []),
          ],
          { env },
        );
        exited = new Promise((resolve) => daemon?.once('exit', resolve));
        await new Promise<void>((resolve, reject) => {
          let out = '',
            err = '';
          const timer = setTimeout(() => reject(new Error('Daemon not ready: ' + err)), 5000);
          daemon?.stderr?.on('data', (chunk: Buffer) => {
            err += chunk.toString();
          });
          daemon?.stdout?.on('data', (chunk: Buffer) => {
            out += chunk.toString();
            if (out.includes('"ready"')) {
              clearTimeout(timer);
              resolve();
            }
          });
          daemon?.once('exit', () => {
            clearTimeout(timer);
            reject(new Error(err));
          });
        });
      };
      const stop = async () => {
        assert.equal((await raw(['daemon', 'stop'])).code, 0);
        assert.equal(await exited, 0);
        daemon = undefined;
      };
      try {
        await start();
        const started = await run([
          'session',
          'start',
          '--agent',
          'owner',
          '--room',
          'room',
          '--message',
          'Prepare session',
        ]);
        assert.ok(
          record(started) && record(started.session) && typeof started.session.id === 'string',
        );
        if (outcome === 'approval-save' || outcome === 'task-save') {
          const fault = new Database(db);
          try {
            fault.run(
              outcome === 'approval-save'
                ? "CREATE TRIGGER linear_approval_fault BEFORE INSERT ON approval_requests BEGIN SELECT RAISE(ABORT,'fixture approval save failure'); END"
                : "CREATE TRIGGER linear_task_fault BEFORE UPDATE ON tasks WHEN json_extract(NEW.data,'$.status')='waiting_approval' BEGIN SELECT RAISE(ABORT,'fixture task save failure'); END",
            );
          } finally {
            fault.close();
          }
        }
        const executionArgs = [
          'task',
          'run',
          'execution',
          '--session',
          started.session.id,
          '--room-message',
          'input',
        ];
        if (outcome !== 'success' && !continuing) {
          const failed = await raw(executionArgs);
          assert.equal(failed.code, 1, failed.err);
          const task = await run(['task', 'get', 'execution']);
          assert.ok(record(task));
          assert.equal(task.status, outcome === 'ambiguous' ? 'assigned' : 'failed');
          assert.deepEqual(task.outputArtifacts, []);
          const originalApprovals = await run(['approval', 'list']);
          assert.ok(Array.isArray(originalApprovals));
          assert.equal(originalApprovals.length, outcome === 'task-save' ? 1 : 0);
          assert.equal(
            readFileSync(calls, 'utf8'),
            ['invalid', 'ambiguous'].includes(outcome) ? '' : 'R',
          );
          assert.equal(readFileSync(turns, 'utf8'), outcome === 'ambiguous' ? 'T' : 'TT');
          await stop();
          await start();
          assert.deepEqual(await run(['task', 'get', 'execution']), task);
          assert.deepEqual(await run(['approval', 'list']), originalApprovals);
          assert.equal((await raw(executionArgs)).code, 1);
          assert.equal(readFileSync(turns, 'utf8'), outcome === 'ambiguous' ? 'T' : 'TT');
          await stop();
          return;
        }
        const result = await run(executionArgs);
        assert.ok(record(result) && record(result.task));
        const waiting = result.task;
        assert.equal(waiting.status, 'waiting_approval');
        assert.deepEqual(waiting.outputArtifacts, []);
        assert.equal(readFileSync(calls, 'utf8'), 'R');
        assert.equal(readFileSync(turns, 'utf8'), 'TT');
        const approvals = await run(['approval', 'list']);
        assert.ok(
          Array.isArray(approvals) &&
            approvals.length === 1 &&
            record(approvals[0]) &&
            record(approvals[0].request),
        );
        const request = approvals[0].request;
        assert.ok(
          typeof request.id === 'string' &&
            record(request.operation) &&
            record(request.operation.binding),
        );
        assert.deepEqual(request.actor, { kind: 'agent', id: 'owner' });
        assert.equal(request.taskId, workId);
        assert.equal(request.operation.binding.taskId, 'execution');
        assert.equal(request.operation.binding.taskVersion, 2);
        assert.equal(
          (
            await raw([
              'task',
              'review',
              'execution',
              '--decision',
              'approve',
              '--actor',
              'founder',
              '--reason',
              'Proposal only',
              '--expected-version',
              String(waiting.version),
            ])
          ).code,
          1,
        );
        if (continuing) {
          assert.equal(
            (
              await raw([
                'task',
                'resume-linear-task',
                'execution',
                '--approval',
                request.id,
                '--expected-version',
                String(waiting.version),
                '--actor',
                'spoof',
              ])
            ).code,
            2,
          );
          const pending = await raw([
            'task',
            'resume-linear-task',
            'execution',
            '--approval',
            request.id,
            '--expected-version',
            String(waiting.version),
          ]);
          assert.equal(pending.code, 1, pending.err);
          assert.equal(readFileSync(calls, 'utf8'), 'R');
        }
        await run([
          'approval',
          'decide',
          request.id,
          '--actor',
          'founder',
          '--decision',
          continuing || mode === 'content' ? 'approve' : 'reject',
          '--reason',
          'Checked operation',
        ]);
        const saved = await run(['approval', 'get', request.id]);
        await stop();
        await start();
        assert.deepEqual(await run(['task', 'get', 'execution']), waiting);
        assert.deepEqual(await run(['approval', 'get', request.id]), saved);
        assert.equal(
          (
            await raw([
              'task',
              'run',
              'execution',
              '--session',
              started.session.id,
              '--room-message',
              'input',
            ])
          ).code,
          1,
        );
        if (continuing) {
          const fault = new Database(db);
          try {
            if (outcome === 'claim' || outcome === 'receipt')
              fault.run(
                "CREATE TRIGGER resume_event_fault BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.type')='linear.update." +
                  (outcome === 'claim' ? 'claimed' : 'updated') +
                  "' BEGIN SELECT RAISE(ABORT,'fixture event fault'); END",
              );
            if (outcome === 'stage')
              fault.run(
                "CREATE TRIGGER resume_stage_fault BEFORE INSERT ON task_artifacts BEGIN SELECT RAISE(ABORT,'fixture stage fault'); END",
              );
            if (outcome === 'blocked')
              fault.run(
                "CREATE TRIGGER resume_blocked_fault BEFORE UPDATE ON tasks WHEN json_extract(NEW.data,'$.status')='blocked' BEGIN SELECT RAISE(ABORT,'fixture blocked fault'); END",
              );
          } finally {
            fault.close();
          }
          if (outcome === 'artifact')
            writeFileSync(db + '.artifacts', 'fixture cannot create directory');
          const args = [
            'task',
            'resume-linear-task',
            'execution',
            '--approval',
            request.id,
            '--expected-version',
            String(waiting.version),
          ];
          const pendingAttempts = Promise.all([raw(args), raw(args)]);
          if (outcome === 'crash') {
            const deadline = Date.now() + 3000;
            while (!readFileSync(calls, 'utf8').includes('W')) {
              assert.ok(Date.now() < deadline, 'Linear mutation not dispatched');
              await Bun.sleep(10);
            }
            daemon?.kill('SIGKILL');
            await exited;
            daemon = undefined;
          }
          const attempts = await pendingAttempts;
          assert.equal(attempts.filter((r) => r.code === 0).length, outcome === 'resume' ? 1 : 0);
          let current = await entity([
            ...(outcome === 'crash' ? ['--direct'] : []),
            'task',
            'get',
            'execution',
          ]);
          assert.ok(record(current));
          assert.equal(
            current.status,
            outcome === 'resume'
              ? 'waiting_approval'
              : outcome === 'claim'
                ? 'failed'
                : ['blocked', 'crash'].includes(outcome)
                  ? 'running'
                  : 'blocked',
          );
          assert.equal(
            readFileSync(calls, 'utf8').split('W').length - 1,
            outcome === 'claim' ? 0 : 1,
          );
          assert.equal(readFileSync(turns, 'utf8'), 'TT');
          if (daemon) await stop();
          const repair = new Database(db);
          try {
            for (const name of ['resume_event_fault', 'resume_stage_fault', 'resume_blocked_fault'])
              repair.run('DROP TRIGGER IF EXISTS ' + name);
          } finally {
            repair.close();
          }
          if (outcome === 'artifact') rmSync(db + '.artifacts');
          await run(['--direct', 'task', 'update', workId, '--title', 'Local WorkItem progressed']);
          await start();
          current = await entity(['task', 'get', 'execution']);
          assert.ok(record(current));
          if (['blocked', 'crash'].includes(outcome)) assert.equal(current.status, 'blocked');
          if (outcome !== 'resume' && outcome !== 'claim') {
            const observeArgs = [
              'task',
              'observe-linear-task',
              'execution',
              '--approval',
              request.id,
              '--expected-version',
              String(current.version),
            ];
            const observations = await Promise.all([
              raw([...observeArgs, '--json']),
              raw([...observeArgs, '--json']),
            ]);
            const winners = observations.filter((result) => result.code === 0);
            assert.equal(winners.length, 1);
            const observed: unknown = JSON.parse(winners[0]?.out ?? 'null');
            assert.ok(record(observed));
            current = observed;
            assert.equal(current.status, 'waiting_approval');
          }
          if (outcome !== 'claim') {
            assert.ok(
              Array.isArray(current.outputArtifacts) && current.outputArtifacts.length === 1,
            );
            const content = await run([
              'task',
              'artifact-content',
              'execution',
              '--artifact',
              String(current.outputArtifacts[0]),
            ]);
            assert.ok(record(content) && typeof content.content === 'string');
            const proof: unknown = JSON.parse(content.content);
            assert.ok(record(proof));
            assert.equal(
              proof.type,
              ['unknown', 'blocked', 'crash', 'receipt'].includes(outcome)
                ? 'linear.update.observed'
                : 'linear.update.updated',
            );
            await run([
              'task',
              'review',
              'execution',
              '--decision',
              'approve',
              '--actor',
              'founder',
              '--reason',
              'Verified native receipt',
              '--expected-version',
              String(current.version),
            ]);
            const completed = await run(['task', 'get', 'execution']);
            assert.ok(record(completed));
            assert.equal(completed.status, 'completed');
          }
          assert.notEqual((await raw(args)).code, 0);
          assert.deepEqual(await run(['approval', 'get', request.id]), saved);
          assert.equal(
            readFileSync(calls, 'utf8').split('W').length - 1,
            outcome === 'claim' ? 0 : 1,
          );
          assert.equal(readFileSync(turns, 'utf8'), 'TT');
          await stop();
          return;
        }
        assert.equal(readFileSync(calls, 'utf8'), 'R');
        assert.equal(readFileSync(turns, 'utf8'), 'TT');
        const messages = await run(['room', 'messages', 'room']);
        assert.ok(Array.isArray(messages));
        assert.equal(messages.length, 2);
        await stop();
      } finally {
        daemon?.kill('SIGKILL');
        if (exited) await exited;
        rmSync(home, { recursive: true, force: true });
      }
    }, 20000);
