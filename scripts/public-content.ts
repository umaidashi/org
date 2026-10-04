export interface PublicFile {
  readonly path: string;
  readonly body: string;
}
export function checkPublicFiles(files: readonly PublicFile[], secrets: readonly string[]): void {
  for (const file of files) {
    if (
      /(^|\/)\.env(?:$|\.)/.test(file.path) &&
      !file.path.endsWith('/.env.example') &&
      file.path !== '.env.example'
    ) {
      throw new Error(`Credential file must not be public: ${file.path}`);
    }
    if (secrets.some((secret) => secret.length >= 12 && file.body.includes(secret))) {
      throw new Error(`Known secret found in ${file.path}`);
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(file.body)) {
      throw new Error(`Private key found in ${file.path}`);
    }
  }
}
