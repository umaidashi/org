import { messageMentions } from '../rooms/domain.js';
import type { Room, Message } from '../rooms/domain.js';
import { readA2AMessage } from '../a2a/domain.js';
export function selectActivationAgents(room: Room, message: Message): readonly string[] {
  if (room.archivedAt !== null) throw new Error('Activation Room is archived');
  if (message.roomId !== room.id) throw new Error('Activation Message belongs to another Room');
  if (!room.participants.some((p) => p.kind === message.sender.kind && p.id === message.sender.id))
    throw new Error('Activation sender is not a Room participant');
  const agents = room.participants.filter((p) => p.kind === 'agent').map((p) => p.id);
  let targets = messageMentions(room, message.metadata);
  if ('a2a' in message.metadata) {
    const envelope = readA2AMessage(message);
    if (!agents.includes(envelope.to)) throw new Error('A2A target is not a Room Agent');
    targets = [envelope.to];
  }
  if (targets.length === 0 && message.sender.kind === 'human') {
    switch (room.activationPolicy) {
      case 'mention_only':
        break;
      case 'all':
        targets = agents;
        break;
      case 'coordinator': {
        const coordinator = room.coordinatorId ?? (agents.length === 1 ? agents[0] : undefined);
        if (coordinator === undefined || !agents.includes(coordinator))
          throw new Error('Room coordinator is not configured');
        targets = [coordinator];
        break;
      }
      case 'rule_based':
        throw new Error('Activation rules are not configured');
    }
  }
  return [...new Set(targets)].filter(
    (id) => message.sender.kind !== 'agent' || message.sender.id !== id,
  );
}
