export async function boundedJson(response: Response, maximum: number): Promise<unknown> {
  if (!response.body) throw new Error('Missing HTTP response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk: unknown = await reader.read();
      if (
        chunk === null ||
        typeof chunk !== 'object' ||
        !('done' in chunk) ||
        typeof chunk.done !== 'boolean'
      )
        throw new Error('Invalid HTTP response chunk');
      if (chunk.done) break;
      const value = 'value' in chunk ? chunk.value : undefined;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid HTTP response bytes');
      size += value.byteLength;
      if (size > maximum) throw new Error('HTTP response size limit');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('Invalid HTTP response JSON');
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
