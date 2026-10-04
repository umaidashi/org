import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { SessionStore } from '../sessions/port.js';
import type { Session } from '../sessions/domain.js';
import {
  createSessionForAgent,
  sendSession,
  stopSession,
  recoverSessions,
} from '../sessions/service.js';
import type { RuntimeTurnInput, RuntimeTurnResult } from './port.js';
type Driver = (input: RuntimeTurnInput, signal?: AbortSignal) => Promise<RuntimeTurnResult>;
type Reply = { readonly session: Session; readonly text: string };
interface ActiveTurn {
  readonly controller: AbortController;
  readonly completion: Promise<Reply>;
}
export class LocalAgentRuntime {
  private readonly active = new Map<string, ActiveTurn>();
  private closed = false;
  constructor(
    private readonly store: Pick<SessionStore, 'create' | 'get' | 'list' | 'save'>,
    private readonly agents: Pick<AgentRepository, 'list'>,
    private readonly rooms: Pick<RoomRepository, 'get'>,
    private readonly drivers: Readonly<Record<'codex' | 'claude', Driver>>,
    private readonly now: () => string,
    private readonly id: () => string,
  ) {}
  async start(input: {
    readonly agentId: string;
    readonly roomId: string;
    readonly message: string;
    readonly instruction: string;
  }): Promise<Reply> {
    if (this.closed) throw new Error('Runtime is closed');
    if (!input.message.trim()) throw new Error('Session message required');
    const session = createSessionForAgent(this.store, this.agents, this.rooms, input, {
      id: this.id(),
      at: this.now(),
    });
    return this.send(session.id, input.message, input.instruction);
  }
  async send(id: string, message: string, instruction = ''): Promise<Reply> {
    if (this.closed) throw new Error('Runtime is closed');
    if (this.active.has(id)) throw new Error('Session runtime turn is active');
    const session = this.store.get(id);
    const controller = new AbortController();
    const completion = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Session cancelled before runtime start');
      return sendSession(
        this.store,
        this.agents,
        this.rooms,
        (input, signal) => this.drivers[session.runtime](input, signal),
        { id, message, instruction },
        this.now,
        controller.signal,
      );
    });
    const active = { controller, completion };
    this.active.set(id, active);
    try {
      return await completion;
    } finally {
      if (this.active.get(id) === active) this.active.delete(id);
    }
  }
  async resume(
    id: string,
    message = 'Continue the previous task.',
    instruction = '',
  ): Promise<Reply> {
    if (this.store.get(id).providerSessionId === null)
      throw new Error('Session has no provider session to resume');
    return this.send(id, message, instruction);
  }
  async stop(id: string): Promise<Session> {
    const active = this.active.get(id);
    let stopped: Session;
    try {
      stopped = stopSession(this.store, id, this.now(), () => active?.controller.abort());
    } catch (error) {
      active?.controller.abort();
      if (active)
        await active.completion.then(
          () => undefined,
          () => undefined,
        );
      throw error;
    }
    if (active)
      await active.completion.then(
        () => undefined,
        () => undefined,
      );
    return stopped;
  }
  recover(): readonly Session[] {
    if (this.active.size !== 0) throw new Error('Cannot recover active runtime turns');
    return recoverSessions(this.store, this.now());
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    const results = await Promise.allSettled([...this.active.keys()].map((id) => this.stop(id)));
    const errors: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        errors.push(reason);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Runtime shutdown failed');
  }
}
