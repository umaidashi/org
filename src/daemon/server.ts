import {
  chmodSync,
  lstatSync,
  mkdirSync,
  rmdirSync,
  unlinkSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  readdirSync,
  constants,
} from 'node:fs';
import { processAlive } from './lease.js';
import type { Stats } from 'node:fs';
import { dirname } from 'node:path';
import { pollDispatch } from './service.js';
import type { Delivery } from './domain.js';
import type { CommandResult } from '../application/port.js';
export interface DaemonOperations {
  dispatch(): readonly Delivery[];
  deliveries(): readonly Delivery[];
  wakeUp?(signal?: AbortSignal): Promise<void>;
  wakeups?(): unknown;
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
function acquireSocketLock(socket: string): number {
  const lock = socket + '.lock';
  try {
    mkdirSync(lock, { mode: 0o700 });
    return lstatSync(lock).ino;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
      throw error;
  }
  // Exclusive recovery guard protects the check/delete/reacquire sequence across starters.
  const recovery = lock + '.recovery';
  mkdirSync(recovery, { mode: 0o700 });
  const recoveryInode = lstatSync(recovery).ino;
  try {
    const ownedLock = lstatSync(lock),
      ownedSocket = entry(socket),
      uid = process.getuid?.();
    if (
      uid === undefined ||
      !ownedLock.isDirectory() ||
      ownedLock.uid !== uid ||
      (ownedLock.mode & 0o777) !== 0o700 ||
      !ownedSocket?.isSocket() ||
      ownedSocket.uid !== uid ||
      (ownedSocket.mode & 0o777) !== 0o600 ||
      readdirSync(lock).length !== 1
    )
      throw new Error('Cannot verify stale daemon ownership');
    const ownerPath = lock + '/owner.json';
    const fd = openSync(
      ownerPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let owner: unknown;
    let ownerInode: number;
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.uid !== uid ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size < 1 ||
        stat.size > 1024
      )
        throw new Error('Invalid daemon ownership file');
      ownerInode = stat.ino;
      const bytes = Buffer.alloc(1025);
      const count = readSync(fd, bytes, 0, bytes.length, 0);
      if (count !== stat.size) throw new Error('Daemon ownership file changed');
      try {
        owner = JSON.parse(bytes.subarray(0, count).toString());
      } catch {
        throw new Error('Invalid daemon ownership record');
      }
    } finally {
      closeSync(fd);
    }
    if (
      !owner ||
      typeof owner !== 'object' ||
      Array.isArray(owner) ||
      Object.keys(owner).some(
        (key) => !['version', 'pid', 'lockInode', 'socketInode'].includes(key),
      ) ||
      !('version' in owner) ||
      owner.version !== 1 ||
      !('pid' in owner) ||
      typeof owner.pid !== 'number' ||
      !Number.isInteger(owner.pid) ||
      owner.pid < 1 ||
      owner.pid > 2147483647 ||
      !('lockInode' in owner) ||
      owner.lockInode !== ownedLock.ino ||
      !('socketInode' in owner) ||
      owner.socketInode !== ownedSocket.ino ||
      processAlive(owner.pid)
    )
      throw new Error('Stale daemon ownership not verified or owner is alive');
    if (
      entry(lock)?.ino !== ownedLock.ino ||
      entry(socket)?.ino !== ownedSocket.ino ||
      entry(ownerPath)?.ino !== ownerInode
    )
      throw new Error('Daemon ownership changed during recovery');
    unlinkSync(socket);
    unlinkSync(ownerPath);
    rmdirSync(lock);
    mkdirSync(lock, { mode: 0o700 });
    return lstatSync(lock).ino;
  } finally {
    if (entry(recovery)?.ino === recoveryInode) rmdirSync(recovery);
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
  const ownerPath = lock + '/owner.json';
  let ownerInode: number | undefined;
  let operations: DaemonOperations | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const wakeController = new AbortController();
  let wakeTask: Promise<void> | undefined;
  let stopping = false;
  let wakeError: string | null = null;
  let onSignal: (() => void) | undefined;
  try {
    lockInode = acquireSocketLock(socket);
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
    const wake = () => {
      if (stopping || wakeTask || !activeOperations.wakeUp) return;
      wakeTask = Promise.resolve()
        .then(() => activeOperations.wakeUp?.(wakeController.signal))
        .then(
          () => {
            wakeError = null;
          },
          () => {
            wakeError = 'Wake-up polling failed';
          },
        )
        .finally(() => {
          wakeTask = undefined;
        });
    };
    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      stopping = true;
      wakeController.abort();
      if (timer) clearInterval(timer);
      stopPromise = (async () => {
        try {
          await activeOperations.shutdown?.();
        } finally {
          await wakeTask;
        }
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
              {
                ...status,
                ...(wakeError === null ? {} : { state: 'degraded', error: wakeError }),
                pid: process.pid,
                pollIntervalMs: interval,
              },
              { headers },
            );
          if (request.method === 'GET' && path === '/v1/wakeups')
            return Response.json(activeOperations.wakeups?.() ?? [], { headers });
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
    writeFileSync(
      ownerPath,
      JSON.stringify({ version: 1, pid: process.pid, lockInode, socketInode }),
      { flag: 'wx', mode: 0o600 },
    );
    ownerInode = lstatSync(ownerPath).ino;
    timer = setInterval(() => {
      status = pollDispatch(() => activeOperations.dispatch());
      wake();
    }, interval);
    onSignal = () => {
      void stop().catch((error) => rejectStopped?.(error));
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    console.log(JSON.stringify({ state: 'ready', socket }));
    wake();
    await stopped;
  } finally {
    stopping = true;
    wakeController.abort();
    if (timer) clearInterval(timer);
    if (onSignal) {
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGINT', onSignal);
    }
    try {
      await server?.stop(true);
    } finally {
      try {
        try {
          try {
            await operations?.shutdown?.();
          } finally {
            await wakeTask;
          }
        } finally {
          await operations?.close();
        }
      } finally {
        try {
          if (socketInode !== undefined && entry(socket)?.ino === socketInode) unlinkSync(socket);
        } finally {
          try {
            if (lockInode !== undefined && entry(lock)?.ino === lockInode) {
              if (ownerInode === undefined) rmdirSync(lock);
              else if (entry(ownerPath)?.ino === ownerInode) {
                unlinkSync(ownerPath);
                rmdirSync(lock);
              }
            }
          } finally {
            process.umask(previousMask);
          }
        }
      }
    }
  }
}
