function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSemanticReview(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.stats)) throw new Error('Invalid semantic review result');
  const { subjects, missing } = value.stats;
  if (typeof subjects !== 'number' || !Number.isInteger(subjects) || subjects <= 0) {
    throw new Error('Semantic review must evaluate subjects');
  }
  if (missing !== 0) throw new Error('Semantic review has missing verdicts');
  for (const field of ['errors', 'degraded']) {
    const entries = value[field];
    if (!Array.isArray(entries) || entries.length !== 0) {
      throw new Error(`Semantic review contains ${field}`);
    }
  }
  if (!Array.isArray(value.findings)) throw new Error('Invalid semantic review findings');
  for (const finding of value.findings) {
    if (
      !isRecord(finding) ||
      typeof finding.severity !== 'string' ||
      !['warning', 'info', 'hint'].includes(finding.severity)
    ) {
      throw new Error('Semantic review contains an error or invalid finding');
    }
  }
}
