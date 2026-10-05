import type { ContextBuilder } from './port.js';
export const boundedContextBuilder: ContextBuilder = {
  build(input) {
    const { room, messages } = input;
    if (messages.some((message) => message.roomId !== room.id))
      throw new Error('Context history contains another Room');
    const index = messages.findIndex((m) => m.id === input.sourceMessageId && m.roomId === room.id);
    if (index < 0) throw new Error('Context source Message not found in Room');
    let memories = input.memories.slice(0, 20);
    let history = messages.slice(Math.max(0, index - 29), index + 1);
    const encode = () =>
      JSON.stringify({
        instruction: input.instruction,
        memories: memories.map(
          ({
            id,
            type,
            scope,
            content,
            confidence,
            sourceRefs,
            validFrom,
            validUntil,
            tags,
            entities,
            importance,
          }) => ({
            ...(tags === undefined ? {} : { tags }),
            ...(entities === undefined ? {} : { entities }),
            ...(importance === undefined ? {} : { importance }),
            ...(validFrom === undefined ? {} : { validFrom }),
            ...(validUntil === undefined ? {} : { validUntil }),
            id,
            type,
            scope,
            content,
            confidence,
            sourceRefs,
          }),
        ),
        omittedMemories: input.memories.length - memories.length,
        room: { id: room.id, title: room.title, type: room.type },
        omittedMessages: index + 1 - history.length,
        messages: history.map(({ id, sender, content, replyTo }) => ({
          id,
          sender,
          content,
          replyTo,
        })),
      });
    let context = encode();
    while (new TextEncoder().encode(context).byteLength > 65536 && memories.length > 0) {
      memories = memories.slice(0, -1);
      context = encode();
    }
    while (new TextEncoder().encode(context).byteLength > 65536 && history.length > 1) {
      history = history.slice(1);
      context = encode();
    }
    if (new TextEncoder().encode(context).byteLength > 65536)
      throw new Error('Source Message context exceeds 64KiB');
    return context;
  },
};
