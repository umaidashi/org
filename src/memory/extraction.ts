import { createHash } from 'node:crypto';
import { requireCapability } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import { createMemory, type Memory } from './domain.js';
import type { MemoryProvider } from './port.js';
import type { MemoryExtractor } from './extractor.js';
export function extractRoomMemories(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  agents: Pick<AgentRepository, 'list'>,
  memories: Pick<MemoryProvider, 'list' | 'createOnce'>,
  extractor: MemoryExtractor,
  input: { readonly roomId: string; readonly messageId: string },
): readonly Memory[] {
  const room = rooms.get(input.roomId);
  if (room.id !== input.roomId || room.archivedAt !== null)
    throw new Error('Memory extraction Room unavailable');
  const messages = rooms.messages(room.id);
  const index = messages.findIndex((m) => m.id === input.messageId && m.roomId === room.id);
  const proposal = messages[index];
  if (
    !proposal ||
    proposal.sender.kind !== 'agent' ||
    !room.participants.some((p) => p.kind === 'agent' && p.id === proposal.sender.id)
  )
    throw new Error('Memory proposal requires participant Agent original');
  const agent = agents.list().find((a) => a.id === proposal.sender.id);
  if (!agent) throw new Error('Memory proposal Agent unavailable');
  requireCapability(agent, 'can_read');
  requireCapability(agent, 'can_write');
  const scope = 'room:' + room.id;
  const existing = memories.list([scope]).filter((m) => m.scope === scope);
  const replaced = new Set<string>();
  const candidates = extractor.extract(proposal.content).map((candidate, ordinal) => {
    for (const sourceId of candidate.sourceMessageIds)
      if (!messages.slice(0, index).some((m) => m.id === sourceId && m.roomId === room.id))
        throw new Error('Memory candidate requires prior same-Room evidence');
    const id =
      'memory:proposal:' +
      createHash('sha256')
        .update(JSON.stringify([room.id, proposal.id, ordinal]))
        .digest('hex');
    if (candidate.supersedes !== undefined) {
      const previous = existing.find((m) => m.id === candidate.supersedes);
      const retry = existing.some((m) => m.id === id && m.supersedes === candidate.supersedes);
      if (
        !previous ||
        previous.type !== candidate.type ||
        (!retry && previous.status !== 'active') ||
        replaced.has(previous.id)
      )
        throw new Error('Memory candidate replacement conflict');
      replaced.add(previous.id);
    }
    return createMemory(
      {
        ...(candidate.tags === undefined ? {} : { tags: candidate.tags }),
        ...(candidate.entities === undefined ? {} : { entities: candidate.entities }),
        ...(candidate.importance === undefined ? {} : { importance: candidate.importance }),
        type: candidate.type,
        content: candidate.content,
        confidence: candidate.confidence,
        scope,
        sourceRefs: [
          ...candidate.sourceMessageIds.map((messageId) => ({ roomId: room.id, messageId })),
          { roomId: room.id, messageId: proposal.id },
        ],
        ...(candidate.supersedes === undefined ? {} : { supersedes: candidate.supersedes }),
      },
      { id, at: proposal.createdAt },
    );
  });
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.supersedes !== null) continue;
    const duplicate = [...existing, ...candidates.slice(0, index)].find(
      (m) => m.type === candidate.type && m.content === candidate.content,
    );
    if (
      duplicate &&
      JSON.stringify([
        duplicate.tags ?? null,
        duplicate.entities ?? null,
        duplicate.importance ?? null,
      ]) !==
        JSON.stringify([
          candidate.tags ?? null,
          candidate.entities ?? null,
          candidate.importance ?? null,
        ])
    )
      throw new Error('Memory candidate metadata conflict requires explicit replacement');
  }
  const results: Memory[] = [];
  for (const candidate of candidates) {
    const own = existing.find((m) => m.id === candidate.id);
    const duplicate =
      candidate.supersedes === null
        ? [...existing, ...results].find(
            (m) => m.type === candidate.type && m.content === candidate.content,
          )
        : undefined;
    results.push(
      own ? memories.createOnce(candidate) : (duplicate ?? memories.createOnce(candidate)),
    );
  }
  return results;
}

export function extractRoomReplyMemories(
  rooms: Pick<RoomRepository, 'get' | 'messages'>,
  agents: Pick<AgentRepository, 'list'>,
  memories: Pick<MemoryProvider, 'list' | 'createOnce'>,
  extractor: MemoryExtractor,
  roomId: string,
  sourceId: string,
  replyIds: readonly string[],
): readonly Memory[] {
  const room = rooms.get(roomId),
    messages = rooms.messages(roomId);
  const source = messages.find((message) => message.id === sourceId && message.roomId === roomId);
  if (!source || source.sender.kind !== 'human') return [];
  if (
    room.id !== roomId ||
    room.archivedAt !== null ||
    !room.participants.some((p) => p.kind === 'human' && p.id === source.sender.id)
  )
    throw new Error('Automatic Memory Room unavailable');
  const proposals = messages.filter((message) => {
    if (
      !replyIds.includes(message.id) ||
      message.roomId !== roomId ||
      message.replyTo !== source.id ||
      message.sender.kind !== 'agent' ||
      Object.hasOwn(message.metadata, 'a2a')
    )
      return false;
    let value: unknown;
    try {
      value = JSON.parse(message.content);
    } catch {
      return false;
    }
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'tool' in value &&
      value.tool === 'memory'
    );
  });
  if (proposals.length > 1) throw new Error('Ambiguous Memory extraction replies');
  const proposal = proposals[0];
  if (!proposal) return [];
  return extractRoomMemories(rooms, agents, memories, extractor, {
    roomId,
    messageId: proposal.id,
  });
}
