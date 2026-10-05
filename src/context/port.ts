import type { Memory } from '../memory/domain.js';
import type { Message, Room } from '../rooms/domain.js';
export interface ContextInput {
  readonly instruction: string;
  readonly room: Room;
  readonly messages: readonly Message[];
  readonly sourceMessageId: string;
  readonly memories: readonly Memory[];
}
export interface ContextBuilder {
  build(input: ContextInput): string;
}
