import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexCommand, parseCodexTurn } from '../src/runtime/codex.js';
import { runProcess } from '../src/runtime/process.js';

test.skipIf(process.env.ORG_CODEX_NATIVE_TEST !== '1')(
  'real Codex native overrides suppress legacy notify and preserve same-provider resume',
  async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-codex-native-test-')),
      marker = join(cwd, 'notify with spaces.txt');
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...(process.env.CODEX_HOME === undefined ? {} : { CODEX_HOME: process.env.CODEX_HOME }),
    };
    const run = async (baseline: boolean, sessionId?: string) => {
      const command = codexCommand(
        {
          agent: { id: 'fixture', role: 'Tester' },
          message: 'Reply exactly READY without calling tools.',
          instruction: 'Follow the message exactly.',
          ...(sessionId === undefined ? {} : { sessionId }),
        },
        'codex',
      );
      const argv = [...command.argv];
      const notify =
        'notify=' + JSON.stringify(['/bin/sh', '-c', 'printf sentinel > "$1"', 'notify', marker]);
      argv.splice(2 + (sessionId === undefined ? 0 : 1), 0, '-c', notify);
      if (baseline) {
        const index = argv.indexOf('notify=[]');
        assert.ok(index > 0);
        argv.splice(index - 1, 2);
      }
      argv.splice(argv.length - 1, 0, '--skip-git-repo-check');
      const result = await runProcess({
        ...command,
        argv,
        env,
        cwd,
        timeoutMs: 60000,
        maxOutputBytes: 65536,
      });
      assert.equal(result.reason, 'exited');
      assert.equal(result.exitCode, 0);
      const turn = parseCodexTurn(result.stdout, sessionId);
      assert.ok(turn.text.trim());
      await Bun.sleep(100);
      return turn;
    };
    try {
      await run(true);
      assert.ok(existsSync(marker));
      rmSync(marker);
      const started = await run(false);
      assert.ok(!existsSync(marker));
      const resumed = await run(false, started.sessionId);
      assert.equal(resumed.sessionId, started.sessionId);
      assert.ok(!existsSync(marker));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  180000,
);
