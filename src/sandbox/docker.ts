import { exportSandboxRepo } from './repo.js';
import { randomUUID } from 'node:crypto';
import type { ProcessInput, ProcessResult } from '../runtime/process.js';
import { validateSandboxInput, SandboxCancelledError, type SandboxInput } from './domain.js';
const image = 'oven/bun@sha256:7608db4aeb44f1fe8169cc8ec7055376b3013557b106407ccf092b00e426407d';
export async function runDockerSandbox(
  run: (input: ProcessInput) => Promise<ProcessResult>,
  host: {
    readonly executable: string;
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly uid: number;
    readonly gid: number;
    readonly credentials?: Readonly<Record<string, string>>;
  },
  input: SandboxInput,
  signal?: AbortSignal,
): Promise<
  ProcessResult & { readonly files: readonly { readonly path: string; readonly base64: string }[] }
> {
  validateSandboxInput(input);
  const credentials = { ...host.credentials };
  const secretValues = Object.values(credentials);
  if (
    secretValues.length > 16 ||
    Object.entries(credentials).some(
      ([name, value]) =>
        !/^[A-Z][A-Z0-9_]{0,120}_(TOKEN|KEY|SECRET|PASSWORD)$/.test(name) ||
        typeof value !== 'string' ||
        !value.length ||
        value.includes('\0') ||
        Buffer.byteLength(value) > 65536,
    ) ||
    secretValues.reduce((total, value) => total + Buffer.byteLength(value), 0) > 65536
  )
    throw new Error('Invalid Sandbox credential environment');
  const rejectReflection = (value: string): void => {
    if (secretValues.some((secret) => value.includes(secret)))
      throw new Error('Sandbox credential output rejected');
  };

  if (
    !Number.isSafeInteger(host.uid) ||
    host.uid < 1 ||
    !Number.isSafeInteger(host.gid) ||
    host.gid < 0
  )
    throw new Error('Sandbox requires a non-root user');
  const repoFiles = input.repo === undefined ? [] : await exportSandboxRepo(input.repo, signal);
  let id: string | undefined;
  async function command(
    argv: readonly string[],
    limit = 10000,
    cancellation: AbortSignal | null | undefined = signal,
    stdin = '',
    maxOutputBytes = 4096,
  ): Promise<ProcessResult> {
    try {
      const result = await run({
        argv: [host.executable, ...argv],
        input: stdin,
        env: host.env,
        cwd: host.cwd,
        timeoutMs: limit,
        maxOutputBytes,
        ...(cancellation === null || cancellation === undefined ? {} : { signal: cancellation }),
      });
      rejectReflection(result.stdout);
      rejectReflection(result.stderr);
      return result;
    } catch (error) {
      rejectReflection(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  async function setup(argv: readonly string[], stdin = ''): Promise<ProcessResult> {
    const result = await command(argv, 10000, signal, stdin);
    if (result.reason === 'cancelled')
      throw new SandboxCancelledError('Sandbox execution cancelled');
    if (result.reason !== 'exited' || result.exitCode !== 0)
      throw new Error(`Sandbox ${argv[0]} failed: ${result.reason} ${result.stderr}`);
    return result;
  }
  async function destroy(containerId: string): Promise<void> {
    const result = await command(['rm', '--force', containerId], 10000, null);
    if (result.reason !== 'exited' || result.exitCode !== 0)
      throw new Error(`Sandbox cleanup failed: ${result.stderr}`);
  }
  try {
    // ponytail: one-shot containers, add reusable sessions only when a caller needs them.
    const created = await setup([
      'create',
      '--rm',
      '--name',
      `org-sandbox-${randomUUID()}`,
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      '--memory=256m',
      '--cpus=1',
      '--user',
      `${host.uid}:${host.gid}`,
      '--tmpfs',
      `/tmp:rw,noexec,nosuid,size=64m,uid=${host.uid},gid=${host.gid},mode=0700`,
      '--tmpfs',
      `/workspace:rw,noexec,nosuid,size=64m,uid=${input.writable ? host.uid : 0},gid=${input.writable ? host.gid : 0},mode=${input.writable ? '0700' : '0755'}`,
      '--workdir=/workspace',
      image,
      'timeout',
      '--signal=KILL',
      `${Math.ceil(input.timeoutMs / 1000) + 30}s`,
      'sleep',
      'infinity',
    ]);
    const candidate = created.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(candidate)) throw new Error('Invalid Docker container ID');
    id = candidate;
    await setup(['start', id]);
    if (repoFiles.length)
      await setup(
        [
          'exec',
          '-i',
          '--user',
          input.writable ? `${host.uid}:${host.gid}` : '0:0',
          id,
          'bun',
          '--no-env-file',
          '-e',
          repoWriter,
        ],
        JSON.stringify(repoFiles),
      );
    await setup(
      [
        'exec',
        '-i',
        '--user',
        input.writable ? `${host.uid}:${host.gid}` : '0:0',
        id,
        'sh',
        '-c',
        'umask 077; cat > /workspace/.org-execution.ts && chmod 0444 /workspace/.org-execution.ts',
      ],
      input.code,
    );
    const execution = await command(
      secretValues.length
        ? ['exec', '-i', id, 'bun', '--no-env-file', '-e', credentialRunner]
        : ['exec', id, 'bun', '--no-env-file', '/workspace/.org-execution.ts'],
      input.timeoutMs,
      signal,
      secretValues.length ? JSON.stringify(credentials) : '',
      input.maxOutputBytes,
    );
    const files: { path: string; base64: string }[] = [];
    if (execution.reason === 'exited' && execution.exitCode === 0 && input.files.length) {
      const collected = await command(
        ['exec', id, 'bun', '--no-env-file', '-e', artifactReader, JSON.stringify(input.files)],
        10000,
        signal,
        '',
        1500000,
      );
      if (collected.reason === 'cancelled')
        throw new SandboxCancelledError('Sandbox execution cancelled');
      if (collected.reason !== 'exited' || collected.exitCode !== 0)
        throw new Error('Sandbox artifact collection failed');
      const decoded: unknown = JSON.parse(collected.stdout);
      if (!Array.isArray(decoded) || decoded.length !== input.files.length)
        throw new Error('Invalid Sandbox artifact collection');
      let total = 0;
      for (const [index, value] of Array.from(decoded, (value: unknown) => value).entries()) {
        if (
          value === null ||
          typeof value !== 'object' ||
          !('path' in value) ||
          !('base64' in value) ||
          value.path !== input.files[index] ||
          typeof value.base64 !== 'string'
        )
          throw new Error('Invalid Sandbox artifact');
        const bytes = Buffer.from(value.base64, 'base64');
        total += bytes.length;
        if (total > 1048576 || bytes.toString('base64') !== value.base64)
          throw new Error('Sandbox artifact size/encoding limit');
        files.push({ path: input.files[index] ?? '', base64: value.base64 });
      }
    }
    for (const file of files) rejectReflection(Buffer.from(file.base64, 'base64').toString('utf8'));
    return { ...execution, files };
  } catch (error) {
    rejectReflection(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    if (id !== undefined) await destroy(id);
  }
}

const artifactReader = `
import {openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
let total=0;
const results=JSON.parse(process.argv[1]).map(path=>{
 const descriptors=[];
 try {
  let parent=openSync('/workspace',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);descriptors.push(parent);
  const parts=path.split('/');
  for(const part of parts.slice(0,-1)){
   parent=openSync('/proc/self/fd/'+parent+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);descriptors.push(parent);
  }
  const fd=openSync('/proc/self/fd/'+parent+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW);descriptors.push(fd);
  if(!fstatSync(fd).isFile())throw new Error('artifact file');
  const bytes=Buffer.alloc(1048577);let count=0;
  while(count<bytes.length){const n=readSync(fd,bytes,count,bytes.length-count,null);if(!n)break;count+=n;}
  total+=count;if(total>1048576)throw new Error('artifact size');
  return {path,base64:bytes.subarray(0,count).toString('base64')};
 }finally{for(const fd of descriptors.reverse())closeSync(fd);}
});
console.log(JSON.stringify(results));
`;

const repoWriter = `
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const files=JSON.parse(await Bun.stdin.text());
for(const file of files){
 const path=resolve('/workspace',file.path);
 if(!path.startsWith('/workspace/'))throw new Error('repo path');
 mkdirSync(dirname(path),{recursive:true,mode:0755});
 writeFileSync(path,Buffer.from(file.base64,'base64'),{flag:'wx',mode:process.getuid()===0?0444:0600});
}
`;

const credentialRunner = `
const credentials=JSON.parse(await Bun.stdin.text());
const child=Bun.spawn([process.execPath,'--no-env-file','/workspace/.org-execution.ts'],{
 env:{PATH:process.env.PATH??'',...credentials},stdin:'ignore',stdout:'inherit',stderr:'inherit'
});
process.exit(await child.exited);
`;
