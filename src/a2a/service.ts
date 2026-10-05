import { verifiedTaskReview, type TaskReviewReader } from '../tasks/review.js';
import { createTask, type Task } from '../tasks/domain.js';
import type { IdempotentTaskWriter, TaskProvider } from '../tasks/port.js';
import { requireCapability } from '../agents/domain.js';
import { createA2AMessage, readA2AMessage, validateA2AReply } from './domain.js';
import type { A2AInput, A2AMessage } from './domain.js';
import type { Identity, Message } from '../rooms/domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { AgentRepository } from '../agents/port.js';
export function authorizeA2AMessage(agents: Pick<AgentRepository, 'list'>, message: Message): void {
  const envelope = readA2AMessage(message);
  if (envelope.type !== 'delegate') return;
  const sender = agents.list().find((agent) => agent.id === envelope.from);
  if (!sender) throw new Error('A2A Agent not found');
  requireCapability(sender, 'can_delegate');
}
export function sendA2AMessage(
  rooms: Pick<RoomRepository, 'get' | 'messages' | 'append'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: { get(id: string): unknown },
  roomId: string,
  input: A2AInput,
  identity: Identity,
): A2AMessage {
  const room = rooms.get(roomId);
  const known = new Set(agents.list().map((agent) => agent.id));
  if (!known.has(input.from) || !known.has(input.to)) throw new Error('A2A Agent not found');
  const reply =
    input.replyTo === undefined
      ? undefined
      : rooms.messages(roomId).find((message) => message.id === input.replyTo);
  const planned = createA2AMessage(room, input, identity, reply);
  const envelope = readA2AMessage(planned);
  authorizeA2AMessage(agents, planned);
  if (envelope.taskId !== null) tasks.get(envelope.taskId);
  const result = rooms.append(
    roomId,
    {
      sender: planned.sender,
      content: planned.content,
      metadata: planned.metadata,
      ...(planned.replyTo !== null ? { replyTo: planned.replyTo } : {}),
    },
    identity,
  );
  return readA2AMessage(result);
}
export function listA2AMessages(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  roomId: string,
  tasks: { get(id: string): unknown },
): readonly A2AMessage[] {
  const room = rooms.get(roomId);
  const messages = rooms.messages(roomId);
  return messages
    .filter((message) => 'a2a' in message.metadata)
    .map((message) => {
      const envelope = readA2AMessage(message);
      if (
        message.roomId !== room.id ||
        ![envelope.from, envelope.to].every((id) =>
          room.participants.some((p) => p.kind === 'agent' && p.id === id),
        )
      )
        throw new Error('Invalid A2A Room endpoints');
      if (room.taskId !== null && envelope.taskId !== room.taskId)
        throw new Error('Invalid A2A Task Room reference');
      if (envelope.taskId !== null) tasks.get(envelope.taskId);
      if (envelope.replyTo !== null) {
        const parent = messages.find((candidate) => candidate.id === envelope.replyTo);
        if (!parent) throw new Error('Invalid A2A reply reference');
        validateA2AReply(envelope, readA2AMessage(parent));
      }
      return envelope;
    });
}

export function delegateA2ATask(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: { get(id: string): unknown } & IdempotentTaskWriter,
  roomId: string,
  messageId: string,
): Task {
  if (rooms.get(roomId).archivedAt !== null) throw new Error('Delegation Room is archived');
  const envelope = listA2AMessages(rooms, roomId, tasks).find(
    (message) => message.id === messageId,
  );
  if (!envelope || envelope.type !== 'delegate' || envelope.from === envelope.to)
    throw new Error('Expected delegate to another Agent');
  const known = agents.list();
  const sender = known.find((agent) => agent.id === envelope.from);
  if (!sender || !known.some((agent) => agent.id === envelope.to))
    throw new Error('A2A Agent not found');
  requireCapability(sender, 'can_delegate');
  const task = {
    ...createTask(
      {
        title: `Delegate: ${envelope.id}`,
        objective: `Delegated by Agent ${envelope.from}: ${JSON.stringify(envelope.payload)}`,
        kind: 'execution_task',
        ...(envelope.taskId === null ? {} : { parentId: envelope.taskId }),
        labels: ['a2a-delegate'],
      },
      { id: `a2a:${envelope.id}`, createdAt: envelope.createdAt },
    ),
    externalRef: `org://rooms/${envelope.roomId}/messages/${envelope.id}`,
  };
  return tasks.createAssignedOnce(task, envelope.to, envelope.createdAt);
}

export async function pollDelegationResults(
  rooms: Pick<RoomRepository, 'list' | 'get' | 'messages' | 'append'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: Pick<TaskProvider, 'list' | 'history'> & { get(id: string): unknown },
  identity: () => Identity,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const knownTasks = new Map(tasks.list({ kind: 'execution_task' }).map((task) => [task.id, task]));
  for (const room of rooms.list()) {
    if (room.archivedAt !== null) continue;
    const envelopes = listA2AMessages(rooms, room.id, tasks);
    for (const source of envelopes.filter((message) => message.type === 'delegate')) {
      if (signal?.aborted) return;
      const task = knownTasks.get(`a2a:${source.id}`);
      if (!task || !['waiting_approval', 'completed', 'failed'].includes(task.status)) continue;
      validateDelegationTask(task, source);
      const existing = envelopes.filter(
        (message) =>
          message.replyTo === source.id &&
          (message.type === 'result' || message.type === 'blocker'),
      );
      if (existing.length > 1) throw new Error('Duplicate delegation result');
      const prior = existing[0];
      if (prior) {
        const payload = prior.payload;
        if (
          payload === null ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          !('executionTaskId' in payload) ||
          payload.executionTaskId !== task.id ||
          !('version' in payload) ||
          typeof payload.version !== 'number' ||
          !('status' in payload) ||
          !('outputArtifacts' in payload)
        )
          throw new Error('Invalid delegation result reference');
        const observed = tasks
          .history(task.id)
          .find((entry) => entry.version === payload.version)?.task;
        if (
          !observed ||
          observed.owner !== source.to ||
          !['waiting_approval', 'completed', 'failed'].includes(observed.status) ||
          observed.status !== payload.status ||
          JSON.stringify(observed.outputArtifacts) !== JSON.stringify(payload.outputArtifacts) ||
          prior.type !==
            (observed.status === 'failed' && observed.outputArtifacts.length === 0
              ? 'blocker'
              : 'result')
        )
          throw new Error('Invalid delegation result snapshot');
        continue;
      }
      sendA2AMessage(
        rooms,
        agents,
        tasks,
        room.id,
        {
          from: source.to,
          to: source.from,
          type:
            task.status === 'failed' && task.outputArtifacts.length === 0 ? 'blocker' : 'result',
          replyTo: source.id,
          payload: {
            executionTaskId: task.id,
            status: task.status,
            version: task.version,
            outputArtifacts: [...task.outputArtifacts],
          },
        },
        identity(),
      );
    }
  }
}

export async function pollDelegationReviews(
  rooms: Pick<RoomRepository, 'list' | 'get' | 'messages' | 'append'>,
  agents: Pick<AgentRepository, 'list'>,
  tasks: Pick<TaskProvider, 'list' | 'history'> & TaskReviewReader & { get(id: string): unknown },
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const known = new Map(tasks.list({ kind: 'execution_task' }).map((task) => [task.id, task]));
  for (const room of rooms.list()) {
    if (room.archivedAt !== null) continue;
    const messages = listA2AMessages(rooms, room.id, tasks);
    for (const source of messages.filter((message) => message.type === 'delegate')) {
      if (signal?.aborted) return;
      const task = known.get(`a2a:${source.id}`);
      if (!task) continue;
      validateDelegationTask(task, source);
      const history = tasks.history(task.id);
      for (const review of tasks.reviews(task.id)) {
        const { before, after } = verifiedTaskReview(history, review);
        if (before.id !== task.id || before.owner !== source.to)
          throw new Error('Delegation review evidence conflict');
        const payload = {
          executionTaskId: task.id,
          reviewRef: `org://tasks/${encodeURIComponent(task.id)}/reviews/${encodeURIComponent(review.id)}`,
          review: { ...review, outputArtifacts: [...review.outputArtifacts] },
          taskRef: `org://tasks/${encodeURIComponent(task.id)}/versions/${after.version}`,
        };
        const id = `a2a-review:${review.id}`;
        const prior = messages.find((message) => message.id === id);
        if (prior) {
          if (
            prior.type !== 'decision' ||
            prior.replyTo !== source.id ||
            JSON.stringify(prior.payload) !== JSON.stringify(payload)
          )
            throw new Error('Delegation review notification conflict');
          continue;
        }
        sendA2AMessage(
          rooms,
          agents,
          tasks,
          room.id,
          { from: source.to, to: source.from, type: 'decision', replyTo: source.id, payload },
          { id, createdAt: review.createdAt },
        );
      }
    }
  }
}

function validateDelegationTask(task: Task, source: A2AMessage): void {
  if (
    task.kind !== 'execution_task' ||
    task.owner !== source.to ||
    task.parentId !== source.taskId ||
    task.externalRef !== `org://rooms/${source.roomId}/messages/${source.id}`
  )
    throw new Error('Delegation Task reference conflict');
}
