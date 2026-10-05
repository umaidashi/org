import type { SecretGrant, SecretStore } from './port.js';

export class EnvironmentSecretStore implements SecretStore {
  private readonly grants = new Map<string, string>();
  constructor(
    grants: readonly SecretGrant[],
    private readonly lookup: (name: string) => string | undefined = (name) => process.env[name],
  ) {
    for (const grant of grants) {
      if (
        typeof grant.actorId !== 'string' ||
        !grant.actorId.trim() ||
        grant.actorId.length > 128 ||
        typeof grant.reference !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(grant.reference) ||
        typeof grant.environmentVariable !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(grant.environmentVariable)
      )
        throw new Error('Invalid secret grant');
      const key = JSON.stringify([grant.actorId, grant.reference]);
      if (this.grants.has(key)) throw new Error('Duplicate secret grant');
      this.grants.set(key, grant.environmentVariable);
    }
  }
  getSecret(actorId: string, reference: string): string {
    const name = this.grants.get(JSON.stringify([actorId, reference]));
    if (name === undefined) throw new Error('Secret access denied');
    let value: string | undefined;
    try {
      value = this.lookup(name);
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
