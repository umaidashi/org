import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { registerRoom } from '../src/rooms/service.js';
test('Room registration validates Agent through a small injected Port before saving', () => {
  let writes = 0;
  const save = {
    create: (room: import('../src/rooms/domain.js').Room) => {
      writes++;
      return room;
    },
  };
  const input = {
    title: 'x',
    type: 'direct',
    participants: [
      { kind: 'human', id: 'founder' },
      { kind: 'agent', id: 'chief' },
    ],
  } as const;
  const identity = { id: 'r', createdAt: 'now' };
  assert.throws(
    () =>
      registerRoom(
        save,
        { list: () => [] },
        {
          get: () => {
            throw new Error('unused Task');
          },
        },
        input,
        identity,
      ),
    /Agent not found/,
  );
  assert.equal(writes, 0);
  const room = registerRoom(
    save,
    {
      list: () => [
        { id: 'chief', name: 'Chief', role: 'Chief', runtime: 'codex', createdAt: 'now' },
      ],
    },
    {
      get: () => {
        throw new Error('unused Task');
      },
    },
    input,
    identity,
  );
  assert.equal(room.id, 'r');
  assert.equal(writes, 1);
});
