import type { Identity, Message } from '../rooms/domain.js';
import type { RoomRepository } from '../rooms/port.js';
import type { readNotionDocument } from './notion.js';
export async function importNotionSnapshot(
  rooms: Pick<RoomRepository, 'get' | 'append'>,
  read: () => ReturnType<typeof readNotionDocument>,
  roomId: string,
  humanId: string,
  identity: Identity,
): Promise<Message> {
  const room = rooms.get(roomId);
  if (
    room.archivedAt !== null ||
    !room.participants.some((p) => p.kind === 'human' && p.id === humanId)
  )
    throw new Error('Notion import requires an active Room and participating human');
  const document = await read();
  return rooms.append(
    roomId,
    {
      sender: { kind: 'human', id: humanId },
      content: `Notion source: ${document.url}\nSHA256: ${document.contentHash}\n\n${document.content}`,
      metadata: {
        knowledge: {
          provider: document.provider,
          id: document.id,
          url: document.url,
          contentHash: document.contentHash,
        },
      },
    },
    identity,
  );
}
