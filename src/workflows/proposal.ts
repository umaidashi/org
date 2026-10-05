import { jsonObject, type JsonObject } from '../events/domain.js';

export function parseWorkflowProposal(content: string): {
  readonly workflowId: string;
  readonly input: JsonObject;
} {
  try {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1048576)
      throw new Error('Invalid size');
    const value: unknown = JSON.parse(content);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['version', 'tool', 'workflowId', 'input'].includes(key)) ||
      !('version' in value) ||
      value.version !== 1 ||
      !('tool' in value) ||
      value.tool !== 'workflow' ||
      !('workflowId' in value) ||
      typeof value.workflowId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value.workflowId) ||
      !('input' in value)
    )
      throw new Error('Invalid fields');
    return { workflowId: value.workflowId, input: jsonObject(value.input) };
  } catch {
    throw new Error('Invalid Workflow proposal');
  }
}
