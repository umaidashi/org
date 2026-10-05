export interface Session {
  readonly rebuiltFrom?: { readonly sessionId: string; readonly version: number };
  readonly id: string;
  readonly agentId: string;
  readonly roomId: string;
  readonly runtime: 'codex' | 'claude';
  readonly providerSessionId: string | null;
  readonly status: 'idle' | 'running' | 'failed' | 'stopped';
  readonly error: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type SessionAction =
  | { readonly type: 'begin' | 'stop'; readonly at: string }
  | { readonly type: 'complete'; readonly providerSessionId: string; readonly at: string }
  | { readonly type: 'fail'; readonly error: string; readonly at: string };
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function decodeSession(value: unknown): Session {
  if (
    !record(value) ||
    !nonempty(value.id) ||
    !nonempty(value.agentId) ||
    !nonempty(value.roomId) ||
    !nonempty(value.createdAt) ||
    !nonempty(value.updatedAt) ||
    (value.runtime !== 'codex' && value.runtime !== 'claude') ||
    (value.providerSessionId !== null && !nonempty(value.providerSessionId)) ||
    (value.status !== 'idle' &&
      value.status !== 'running' &&
      value.status !== 'failed' &&
      value.status !== 'stopped') ||
    (value.error !== null && !nonempty(value.error)) ||
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0
  )
    throw new Error('Invalid Session');
  const origin = value.rebuiltFrom;
  let rebuiltFrom: Session['rebuiltFrom'];
  if (origin !== undefined) {
    if (
      !record(origin) ||
      !nonempty(origin.sessionId) ||
      origin.sessionId === value.id ||
      typeof origin.version !== 'number' ||
      !Number.isSafeInteger(origin.version) ||
      origin.version < 0 ||
      Object.keys(origin).some((key) => !['sessionId', 'version'].includes(key))
    )
      throw new Error('Invalid Session reconstruction origin');
    rebuiltFrom = { sessionId: origin.sessionId, version: origin.version };
  }
  if ((value.status === 'failed') !== (value.error !== null))
    throw new Error('Invalid Session error state');
  return {
    id: value.id,
    agentId: value.agentId,
    roomId: value.roomId,
    runtime: value.runtime,
    providerSessionId: value.providerSessionId,
    status: value.status,
    error: value.error,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(rebuiltFrom === undefined ? {} : { rebuiltFrom }),
  };
}
export function createSession(
  input: Pick<Session, 'agentId' | 'roomId' | 'runtime'>,
  identity: { readonly id: string; readonly at: string },
): Session {
  return decodeSession({
    ...input,
    id: identity.id,
    providerSessionId: null,
    status: 'idle',
    error: null,
    version: 0,
    createdAt: identity.at,
    updatedAt: identity.at,
  });
}
export function transitionSession(session: Session, action: SessionAction): Session {
  const current = decodeSession(session);
  if (!nonempty(action.at)) throw new Error('Session transition time required');
  const next = { ...current, version: current.version + 1, updatedAt: action.at, error: null };
  switch (action.type) {
    case 'begin':
      if (current.status === 'running') throw new Error('Session turn already running');
      return decodeSession({ ...next, status: 'running' });
    case 'complete':
      if (current.status !== 'running') throw new Error('Session turn not running');
      if (
        current.providerSessionId !== null &&
        current.providerSessionId !== action.providerSessionId
      )
        throw new Error('Session provider ID mismatch');
      return decodeSession({
        ...next,
        status: 'idle',
        providerSessionId: action.providerSessionId,
      });
    case 'fail':
      if (current.status !== 'running') throw new Error('Session turn not running');
      return decodeSession({ ...next, status: 'failed', error: action.error });
    case 'stop':
      return decodeSession({ ...next, status: 'stopped' });
  }
}
