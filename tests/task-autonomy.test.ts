import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask } from '../src/tasks/domain.js';
import { createMessage } from '../src/rooms/domain.js';
import { createSession } from '../src/sessions/domain.js';
import { pollExecutionTasks } from '../src/tasks/autonomy.js';
import type { Room, Message } from '../src/rooms/domain.js';
import type { Task } from '../src/tasks/domain.js';
const assigned = {
  ...createTask(
    { title: 'Research', objective: 'Evidence', kind: 'execution_task' },
    { id: 'task', createdAt: 'before' },
  ),
  owner: 'chief',
  status: 'assigned' as const,
  version: 1,
};
function fixture() {
  const tasks = new Map<string, Task>([['task', assigned]]),
    rooms: Room[] = [],
    messages: Message[] = [],
    sessions = [
      createSession(
        { agentId: 'chief', roomId: 'unused', runtime: 'codex' },
        { id: 'unused', at: 'before' },
      ),
    ];
  let opens = 0,
    runs = 0,
    ids = 0;
  const provider = {
    list: () => [...tasks.values()],
    get: (id: string) => {
      const task = tasks.get(id);
      assert.ok(task);
      return task;
    },
    update: (
      id: string,
      patch: Parameters<import('../src/tasks/port.js').TaskProvider['update']>[1],
      _at: string,
      version?: number,
    ) => {
      const task = tasks.get(id);
      assert.ok(task);
      assert.equal(task.version, version);
      const result = { ...task, ...patch, version: task.version + 1 };
      tasks.set(id, result);
      return result;
    },
  };
  const roomStore = {
    list: () => rooms,
    create: (room: Room) => {
      rooms.push(room);
      return room;
    },
    messages: (id: string) => messages.filter((m) => m.roomId === id),
    append: (
      id: string,
      input: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      const room = rooms.find((r) => r.id === id);
      assert.ok(room);
      const m = createMessage(room, input, identity);
      messages.push(m);
      return m;
    },
  };
  const open = (agentId: string, roomId: string) => {
    opens++;
    const session = createSession(
      { agentId, roomId, runtime: 'codex' },
      { id: 'session', at: 'now' },
    );
    sessions.push(session);
    return session;
  };
  const run = async (taskId: string, sessionId: string, messageId: string) => {
    runs++;
    assert.equal(taskId, 'task');
    assert.equal(sessionId, 'session');
    const source = messages.find((m) => m.id === messageId);
    assert.ok(source);
    assert.equal(source.content, 'Evidence');
    assert.equal(source.metadata.executionTaskId, 'task');
    const room = rooms.find((r) => r.id === source.roomId);
    assert.ok(room);
    const reply = createMessage(
      room,
      { sender: { kind: 'agent', id: 'chief' }, content: 'Done', replyTo: messageId },
      { id: 'reply', createdAt: 'later' },
      source,
    );
    const task = { ...assigned, status: 'waiting_approval' as const, version: 3 };
    tasks.set(task.id, task);
    return { task, reply };
  };
  return {
    tasks,
    rooms,
    messages,
    sessions,
    provider,
    roomStore,
    open,
    run,
    stats: () => ({ opens, runs }),
    identity: () => ({ id: 'id' + ids++, createdAt: 'now' }),
  };
}
test('automatic Task execution prepares one Task Room/input/Session and stages only assigned work without replay', async () => {
  const f = fixture();
  await pollExecutionTasks(
    f.provider,
    f.roomStore,
    { list: () => f.sessions },
    f.open,
    f.run,
    f.identity,
  );
  assert.equal(f.rooms.length, 1);
  assert.equal(f.rooms[0]?.taskId, 'task');
  assert.equal(f.messages.length, 1);
  assert.deepEqual(f.stats(), { opens: 1, runs: 1 });
  assert.equal(f.tasks.get('task')?.status, 'waiting_approval');
  await pollExecutionTasks(
    f.provider,
    f.roomStore,
    { list: () => f.sessions },
    f.open,
    f.run,
    f.identity,
  );
  assert.deepEqual(f.stats(), { opens: 1, runs: 1 });
});
test('automatic Task execution defers dependencies, WorkItems and cancellation, and records preparation failure at its observed version', async () => {
  const f = fixture();
  f.tasks.set('dependency', {
    ...assigned,
    id: 'dependency',
    kind: 'work_item',
    status: 'pending',
    owner: null,
  });
  f.tasks.set('task', { ...assigned, dependencies: ['dependency'] });
  await pollExecutionTasks(
    f.provider,
    f.roomStore,
    { list: () => f.sessions },
    f.open,
    f.run,
    f.identity,
  );
  assert.deepEqual(f.stats(), { opens: 0, runs: 0 });
  assert.equal(f.rooms.length, 0);
  f.tasks.set('task', assigned);
  const controller = new AbortController();
  controller.abort();
  await pollExecutionTasks(
    f.provider,
    f.roomStore,
    { list: () => f.sessions },
    f.open,
    f.run,
    f.identity,
    controller.signal,
  );
  assert.deepEqual(f.stats(), { opens: 0, runs: 0 });
  await pollExecutionTasks(
    f.provider,
    f.roomStore,
    { list: () => f.sessions },
    () => {
      throw new Error('Preparation failed');
    },
    f.run,
    f.identity,
  );
  assert.equal(f.tasks.get('task')?.status, 'failed');
  assert.equal(f.stats().runs, 0);
});
test('automatic Task execution leaves busy work and later Tasks unstarted when cancellation arrives', async () => {
  const busy = fixture();
  const room = busy.roomStore.create({
    id: 'task-room',
    title: 'Task',
    type: 'task',
    taskId: 'task',
    participants: [{ kind: 'agent', id: 'chief' }],
    activationPolicy: 'coordinator',
    createdAt: 'before',
    archivedAt: null,
  });
  const existing = busy.sessions[0];
  assert.ok(existing);
  busy.sessions.push({
    ...existing,
    id: 'busy',
    agentId: 'chief',
    roomId: room.id,
    status: 'running',
  });
  await pollExecutionTasks(
    busy.provider,
    busy.roomStore,
    { list: () => busy.sessions },
    busy.open,
    busy.run,
    busy.identity,
  );
  assert.deepEqual(busy.stats(), { opens: 0, runs: 0 });
  assert.equal(busy.messages.length, 0);
  const f = fixture(),
    controller = new AbortController();
  f.tasks.set('later', { ...assigned, id: 'later' });
  await pollExecutionTasks(
    f.provider,
    f.roomStore,
    { list: () => f.sessions },
    f.open,
    async (...args) => {
      const result = await f.run(...args);
      controller.abort();
      return result;
    },
    f.identity,
    controller.signal,
  );
  assert.deepEqual(f.stats(), { opens: 1, runs: 1 });
  assert.equal(f.tasks.get('later')?.status, 'assigned');
  assert.equal(f.rooms.length, 1);
});
