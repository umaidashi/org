import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { SecretStore } from './port.js';
export interface KeychainLocation {
  readonly path: string;
  readonly service: string;
  readonly account: string;
}
export interface KeychainGrant extends KeychainLocation {
  readonly actorId: string;
  readonly reference: string;
}
function nativeLookup(location: KeychainLocation): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const result = spawnSync(
    '/usr/bin/security',
    ['find-generic-password', '-s', location.service, '-a', location.account, '-w', location.path],
    {
      env: { PATH: '/usr/bin:/bin' },
      timeout: 5000,
      maxBuffer: 65537,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.status !== 0 || result.error) return undefined;
  const output = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  return output.endsWith('\n') ? output.slice(0, -1) : output;
}
export class KeychainSecretStore implements SecretStore {
  private readonly grants = new Map<string, KeychainLocation>();
  constructor(
    grants: readonly KeychainGrant[],
    private readonly lookup: (location: KeychainLocation) => string | undefined = nativeLookup,
  ) {
    for (const grant of grants) {
      if (
        typeof grant.actorId !== 'string' ||
        !grant.actorId.trim() ||
        grant.actorId.length > 128 ||
        typeof grant.reference !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(grant.reference) ||
        typeof grant.path !== 'string' ||
        !isAbsolute(grant.path) ||
        grant.path.length > 4096 ||
        /[\0\r\n]/.test(grant.path)
      )
        throw new Error('Invalid Keychain secret grant');
      for (const field of [grant.service, grant.account])
        if (
          typeof field !== 'string' ||
          !field.trim() ||
          field.length > 256 ||
          field.startsWith('-') ||
          /[\0\r\n]/.test(field)
        )
          throw new Error('Invalid Keychain secret grant');
      const key = JSON.stringify([grant.actorId, grant.reference]);
      if (this.grants.has(key)) throw new Error('Duplicate secret grant');
      this.grants.set(key, { path: grant.path, service: grant.service, account: grant.account });
    }
  }
  getSecret(actorId: string, reference: string): string {
    const location = this.grants.get(JSON.stringify([actorId, reference]));
    if (location === undefined) throw new Error('Secret access denied');
    let value: string | undefined;
    try {
      value = this.lookup({ ...location });
    } catch {
      throw new Error('Secret unavailable');
    }
    if (
      typeof value !== 'string' ||
      !value.length ||
      Buffer.byteLength(value) > 65536 ||
      value.includes('\0')
    )
      throw new Error('Secret unavailable');
    return value;
  }
}
