import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { memoryContextScopes, parseMemoryContextGrants } from '../src/context/scopes.js';
import { parseDaemonCommand } from '../src/daemon/cli.js';

test('host Memory context grants reject unsafe or duplicate pairs and allow only bounded department/project scopes', () => {
  const input = [{ roomId: 'r', agentId: 'a', scopes: ['department:engineering', 'project:org'] }];
  const grants = parseMemoryContextGrants(input);
  assert.deepEqual(grants, input);
  input[0]?.scopes.push('project:elsewhere');
  assert.deepEqual(grants[0]?.scopes, ['department:engineering', 'project:org']);
  const valid = { roomId: 'r', agentId: 'a', scopes: ['project:org'] };
  for (const value of [
    null,
    {},
    [null],
    [{ ...valid, typo: true }],
    [{ ...valid, agentId: '' }],
    [{ ...valid, roomId: '\0' }],
    [{ ...valid, roomId: 'r'.repeat(129) }],
    [valid, valid],
    Array.from({ length: 33 }, (_, i) => ({ ...valid, roomId: String(i) })),
  ])
    assert.throws(() => parseMemoryContextGrants(value));
  for (const scopes of [
    null,
    {},
    ['global'],
    ['room:r'],
    ['agent:a'],
    ['task:t'],
    ['company'],
    ['department:'],
    ['project:has space'],
    ['project:x\0'],
    [7],
    ['project:a', 'project:a'],
    ['project:' + 'a'.repeat(256)],
    Array.from({ length: 33 }, (_, i) => 'project:' + i),
  ])
    assert.throws(() => memoryContextScopes(scopes));
  assert.deepEqual(memoryContextScopes([]), []);
  const flags = [
    '--runtime-config',
    '/tmp/runtime.json',
    '--memory-context-config',
    '/tmp/context.json',
  ];
  assert.equal(parseDaemonCommand(['daemon', ...flags]).memoryContextConfig, '/tmp/context.json');
  for (const args of [
    ['daemon', '--memory-context-config', '/tmp/context.json'],
    ['daemon', ...flags, '--once'],
    ['daemon', 'status', ...flags],
    ['daemon', '--runtime-config', '/tmp/runtime.json', '--memory-context-config', ' '],
  ])
    assert.throws(() => parseDaemonCommand(args));
});
