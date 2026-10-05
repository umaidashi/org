export interface SecretStore {
  getSecret(actorId: string, reference: string): string;
}
export interface SecretGrant {
  readonly actorId: string;
  readonly reference: string;
  readonly environmentVariable: string;
}
