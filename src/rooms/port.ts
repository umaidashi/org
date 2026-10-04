import type { Identity, Message, MessageInput, Room } from './domain.js';
export interface RoomRepository {
  create(room: Room): Room;
  get(id: string): Room;
  list(): readonly Room[];
  archive(id: string, archivedAt: string): Room;
  append(roomId: string, input: MessageInput, identity: Identity): Message;
  messages(roomId: string): readonly Message[];
}
