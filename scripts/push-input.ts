export function parsePushUpdates(input: string): readonly string[] {
  const result = new Set<string>();
  for (const line of input.split('\n').filter((line) => line.trim() !== '')) {
    const fields = line.trim().split(/\s+/);
    const [, localOid, , remoteOid] = fields;
    const validOid = /^[a-f\d]{40}(?:[a-f\d]{24})?$/;
    if (
      fields.length !== 4 ||
      !localOid ||
      !remoteOid ||
      !validOid.test(localOid) ||
      !validOid.test(remoteOid)
    ) {
      throw new Error('Invalid pre-push input');
    }
    if (!/^0+$/.test(localOid)) result.add(localOid);
  }
  return [...result];
}
