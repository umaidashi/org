import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAgentRuntime } from '../src/runtime/manager.js';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { runCodexTurn } from '../src/runtime/codex.js';
import { runClaudeTurn } from '../src/runtime/claude.js';
import { runProcess } from '../src/runtime/process.js';
import type { RuntimeTurnInput } from '../src/runtime/port.js';
for (const runtime of ['codex', 'claude'] as const) {
  test(`Session ${runtime} lifecycle manager connects SQLite to real fixture process for start resume and stop`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'org-session-runtime-'));
    const store = new SqliteSessionStore(join(dir, 'org.db'));
    const agents = {
      list: () => [
        {
          id: 'a',
          name: 'chief',
          role: 'Chief',
          runtime,
          createdAt: 't0',
          capabilities: ['can_read' as const],
        },
      ],
    };
    const rooms = {
      get: () => ({
        id: 'r',
        title: 'work',
        type: 'agent' as const,
        participants: [{ kind: 'agent' as const, id: 'a' }],
        activationPolicy: 'coordinator' as const,
        taskId: null,
        createdAt: 't0',
        archivedAt: null,
      }),
    };
    let started: (() => void) | undefined;
    const source = `const raw = await Bun.stdin.text();
      const message = ${runtime === 'codex' ? 'JSON.parse(raw).message' : 'raw'};
      if (message === 'wait') setInterval(() => {}, 100);
      else if (${JSON.stringify(runtime)} === 'codex') {
        for(const flag of ['features.shell_tool=false', 'features.view_image=false', 'features.hooks=false',
            'notify=[]', 'features.apps=false', 'features.plugins=false', 'features.multi_agent=false', 'web_search="disabled"']) {
          const index=process.argv.indexOf(flag);if(index<1||process.argv[index-1]!=='-c')throw new Error('Native shell boundary missing');
        }
        console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));
        console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:message}}));
        console.log(JSON.stringify({type:'turn.completed',usage:{}}));
      } else console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:'provider',result:message}));`;
    let calls = 0;
    const run = async (input: RuntimeTurnInput, signal?: AbortSignal) => {
      calls++;
      assert.equal(input.sessionId, calls === 1 ? undefined : 'provider');
      const adapter = runtime === 'codex' ? runCodexTurn : runClaudeTurn;
      return adapter(
        async (processInput) => {
          const pending = runProcess({
            ...processInput,
            argv: [
              process.execPath,
              '--no-env-file',
              '-e',
              source,
              '--',
              ...processInput.argv.slice(1),
            ],
          });
          started?.();
          return pending;
        },
        input,
        {
          executable: runtime,
          cwd: dir,
          env: {},
          timeoutMs: 2000,
          maxOutputBytes: 4096,
          ...(signal ? { signal } : {}),
        },
      );
    };
    const manager = new LocalAgentRuntime(
      store,
      agents,
      rooms,
      { codex: run, claude: run },
      () => 'now',
      () => 's',
    );
    try {
      const first = await manager.start({
        agentId: 'a',
        roomId: 'r',
        message: 'first',
        instruction: 'Review',
      });
      assert.equal(first.text, 'first');
      assert.equal(first.session.providerSessionId, 'provider');
      const resumed = await manager.resume('s', 'resumed', 'Review');
      assert.equal(resumed.text, 'resumed');
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const turn = manager.send('s', 'wait');
      const rejected = assert.rejects(turn);
      await ready;
      await manager.stop('s');
      await rejected;
      assert.equal(store.get('s').status, 'stopped');
      assert.deepEqual(manager.recover(), []);
      assert.deepEqual(
        store.history('s').map((session) => session.status),
        ['idle', 'running', 'idle', 'running', 'idle', 'running', 'stopped'],
      );
    } finally {
      await manager.shutdown();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
