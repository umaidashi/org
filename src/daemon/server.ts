import { chmodSync, lstatSync, mkdirSync, rmdirSync, unlinkSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname } from 'node:path';
import { pollDispatch } from './service.js';
import type { Delivery } from './domain.js';
import type { CommandResult } from '../application/port.js';
export interface DaemonOperations {
  dispatch(): readonly Delivery[];
  deliveries(): readonly Delivery[];
  close(): void | Promise<void>;
  shutdown?(): Promise<void>;
  command?(argv: string[]): CommandResult | Promise<CommandResult>;
}
function entry(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
}
export async function runLocalDaemon(
  socket: string,
  interval: number,
  createOperations: () => DaemonOperations,
): Promise<void> {
  mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
  const previousMask = process.umask(0o077);
  const lock = `${socket}.lock`;
  let lockInode: number | undefined;
  let socketInode: number | undefined;
  let operations: DaemonOperations | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let onSignal: (() => void) | undefined;
  try {
    mkdirSync(lock, { mode: 0o700 });
    lockInode = lstatSync(lock).ino;
    if (entry(socket)) throw new Error('Socket path already exists; refusing to replace it');
    const activeOperations = createOperations();
    operations = activeOperations;
    let status = pollDispatch(() => activeOperations.dispatch());
    let resolveStopped: (() => void) | undefined;
    let rejectStopped: ((error: unknown) => void) | undefined;
    const stopped = new Promise<void>((resolve, reject) => {
      resolveStopped = resolve;
      rejectStopped = reject;
    });
    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      if (timer) clearInterval(timer);
      stopPromise = (async () => {
        await activeOperations.shutdown?.();
        await server?.stop();
        resolveStopped?.();
      })();
      return stopPromise;
    };
    server = Bun.serve({
      unix: socket,
      maxRequestBodySize: 1024 * 1024,
      async fetch(request) {
        const headers = { Connection: 'close' };
        if (request.headers.has('origin'))
          return Response.json({ error: 'Origin is not allowed' }, { status: 403, headers });
        const path = new URL(request.url).pathname;
        if (request.method === 'POST' && path === '/v1/command') {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: 'Invalid command JSON' }, { status: 400, headers });
          }
          if (
            body === null ||
            typeof body !== 'object' ||
            !('argv' in body) ||
            Object.keys(body).length !== 1 ||
            !Array.isArray(body.argv) ||
            body.argv.length > 256 ||
            !body.argv.every((value: unknown) => typeof value === 'string' && value.length <= 65536)
          )
            return Response.json({ error: 'Invalid command arguments' }, { status: 400, headers });
          const argv = body.argv.map((value: unknown) => {
            if (typeof value !== 'string') throw new Error('Invalid command argument');
            return value;
          });
          if (!activeOperations.command)
            return Response.json(
              { error: 'Command handler unavailable' },
              { status: 503, headers },
            );
          server?.timeout(request, 0);
          return Response.json(await activeOperations.command(argv), { headers });
        }
        try {
          if (request.method === 'GET' && path === '/v1/status')
            return Response.json(
              { ...status, pid: process.pid, pollIntervalMs: interval },
              { headers },
            );
          if (request.method === 'GET' && path === '/v1/deliveries')
            return Response.json(activeOperations.deliveries(), { headers });
          if (request.method === 'POST' && path === '/v1/dispatch') {
            const deliveries = activeOperations.dispatch();
            status = { state: 'running', processed: deliveries.length, error: null };
            return Response.json(deliveries, { headers });
          }
          if (request.method === 'POST' && path === '/v1/stop') {
            queueMicrotask(() => {
              void stop().catch((error) => rejectStopped?.(error));
            });
            return Response.json({ state: 'stopping' }, { headers });
          }
          return Response.json({ error: 'Unknown method or endpoint' }, { status: 404, headers });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          status = { state: 'degraded', processed: 0, error: message };
          return Response.json({ error: message }, { status: 500, headers });
        }
      },
    });
    socketInode = lstatSync(socket).ino;
    chmodSync(socket, 0o600);
    timer = setInterval(() => {
      status = pollDispatch(() => activeOperations.dispatch());
    }, interval);
    onSignal = () => {
      void stop().catch((error) => rejectStopped?.(error));
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    console.log(JSON.stringify({ state: 'ready', socket }));
    await stopped;
  } finally {
    if (timer) clearInterval(timer);
    if (onSignal) {
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGINT', onSignal);
    }
    try {
      await server?.stop(true);
    } finally {
      try {
        await operations?.close();
      } finally {
        try {
          if (socketInode !== undefined && entry(socket)?.ino === socketInode) unlinkSync(socket);
        } finally {
          try {
            if (lockInode !== undefined && entry(lock)?.ino === lockInode) rmdirSync(lock);
          } finally {
            process.umask(previousMask);
          }
        }
      }
    }
  }
}
