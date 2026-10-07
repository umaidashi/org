import {
  linearIssueFieldNames,
  parseLinearIssueFieldMask,
  type LinearIssueField,
} from '../approvals/domain.js';
import type { SecretStore } from '../secrets/port.js';
import { queryLinear, parseLinearIssue, readLinearIssue, type LinearIssue } from './read.js';
export interface LinearIssueFields {
  readonly stateId?: string;
  readonly assigneeId?: string | null;
  readonly labelIds?: readonly string[];
  readonly priority?: number;
}
function parsePriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4)
    throw new Error('Invalid Linear priority');
  return value;
}
function modelId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
  )
    throw new Error('Invalid Linear model UUID');
  return value;
}
export function parseLinearIssueFields(value: unknown): LinearIssueFields {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length < 1 ||
    Object.keys(value).some((key) => !linearIssueFieldNames.some((name) => name === key))
  )
    throw new Error('Invalid Linear Issue fields');
  const stateId = 'stateId' in value ? modelId(value.stateId) : undefined;
  const assigneeId =
    'assigneeId' in value
      ? value.assigneeId === null
        ? null
        : modelId(value.assigneeId)
      : undefined;
  let labelIds: string[] | undefined;
  if ('labelIds' in value) {
    if (!Array.isArray(value.labelIds) || value.labelIds.length > 100)
      throw new Error('Invalid Linear label IDs');
    labelIds = Array.from(value.labelIds, modelId).sort();
    if (new Set(labelIds).size !== labelIds.length) throw new Error('Duplicate Linear label IDs');
  }
  return {
    ...(stateId === undefined ? {} : { stateId }),
    ...(assigneeId === undefined ? {} : { assigneeId }),
    ...(labelIds === undefined ? {} : { labelIds }),
    ...('priority' in value ? { priority: parsePriority(value.priority) } : {}),
  };
}
export function linearIssueFieldSelection(mask: readonly LinearIssueField[]): string {
  return parseLinearIssueFieldMask(mask)
    .map((name) =>
      name === 'stateId'
        ? 'state { id }'
        : name === 'assigneeId'
          ? 'assignee { id }'
          : name === 'labelIds'
            ? 'labels(first: 100) { nodes { id } pageInfo { hasNextPage } }'
            : 'priority',
    )
    .join(' ');
}
function relatedId(value: unknown): string {
  if (!value || typeof value !== 'object' || !('id' in value))
    throw new Error('Invalid Linear related entity');
  return modelId(value.id);
}
export type LinearUpdateIssue = LinearIssue & { readonly fields?: LinearIssueFields };
export function parseLinearUpdateIssue(
  value: unknown,
  mask?: readonly LinearIssueField[],
): LinearUpdateIssue {
  const issue = parseLinearIssue(value);
  if (!mask) return issue;
  if (!value || typeof value !== 'object') throw new Error('Invalid Linear Issue fields response');
  let stateId: string | undefined,
    assigneeId: string | null | undefined,
    labelIds: string[] | undefined,
    priority: number | undefined;
  for (const name of parseLinearIssueFieldMask(mask)) {
    if (name === 'stateId') {
      if (!('state' in value)) throw new Error('Missing Linear state');
      stateId = relatedId(value.state);
    } else if (name === 'assigneeId') {
      if (!('assignee' in value)) throw new Error('Missing Linear assignee');
      assigneeId = value.assignee === null ? null : relatedId(value.assignee);
    } else if (name === 'priority') {
      priority = parsePriority('priority' in value ? value.priority : undefined);
    } else {
      if (
        !('labels' in value) ||
        !value.labels ||
        typeof value.labels !== 'object' ||
        !('nodes' in value.labels) ||
        !Array.isArray(value.labels.nodes) ||
        !('pageInfo' in value.labels) ||
        !value.labels.pageInfo ||
        typeof value.labels.pageInfo !== 'object' ||
        !('hasNextPage' in value.labels.pageInfo) ||
        value.labels.pageInfo.hasNextPage !== false
      )
        throw new Error('Incomplete Linear labels');
      labelIds = Array.from(value.labels.nodes, relatedId);
    }
  }
  return {
    ...issue,
    fields: parseLinearIssueFields({
      ...(stateId === undefined ? {} : { stateId }),
      ...(assigneeId === undefined ? {} : { assigneeId }),
      ...(labelIds === undefined ? {} : { labelIds }),
      ...(priority === undefined ? {} : { priority }),
    }),
  };
}
export async function readLinearUpdateIssue(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  id: string,
  mask?: readonly LinearIssueField[],
): Promise<LinearUpdateIssue> {
  if (!mask) return readLinearIssue(request, secrets, id);
  modelId(id);
  const data = await queryLinear(
    request,
    secrets,
    'query KernelIssueFields($id: String!) { issue(id: $id) { id identifier title description url ' +
      linearIssueFieldSelection(mask) +
      ' } }',
    { id },
  );
  const issue = parseLinearUpdateIssue(data.issue, mask);
  if (issue.id !== id) throw new Error('Linear Issue identity mismatch');
  return issue;
}
