import type { AgentRepository } from '../agents/port.js';
import type { SecretStore } from '../secrets/port.js';
import { createTask, isTaskStatus, type TaskStatus, type WorkItem } from '../tasks/domain.js';
import { parseLinearIssueFields, parseLinearUpdateIssue } from './fields.js';
import {
  queryLinear,
  validateLinearIssueId,
  validateLinearIssueListInput,
  parseLinearIssuePage,
  type LinearIssueListInput,
} from './read.js';

const coreFields =
  'id identifier title description url priority createdAt updatedAt state { id } assignee { id } labels(first: 100) { nodes { id name } pageInfo { hasNextPage } }';

export interface LinearTaskMapping {
  readonly states: Readonly<Record<string, TaskStatus>>;
  readonly owners: Readonly<Record<string, string>>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseLinearTaskMapping(value: unknown): LinearTaskMapping {
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    !record(value.states) ||
    !record(value.owners)
  )
    throw new Error('Invalid Linear Task mapping');
  const states = Object.fromEntries(
    Object.entries(value.states).map(([id, status]) => {
      parseLinearIssueFields({ stateId: id });
      if (!isTaskStatus(status)) throw new Error('Invalid Linear state mapping');
      return [id, status];
    }),
  );
  const owners = Object.fromEntries(
    Object.entries(value.owners).map(([id, agent]) => {
      parseLinearIssueFields({ assigneeId: id });
      if (typeof agent !== 'string' || !agent.trim() || agent.includes('\0') || agent.length > 128)
        throw new Error('Invalid Linear owner mapping');
      return [id, agent];
    }),
  );
  if (
    !Object.keys(states).length ||
    Object.keys(states).length > 100 ||
    Object.keys(owners).length > 256
  )
    throw new Error('Invalid Linear mapping size');
  return { states, owners };
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error('Invalid Linear timestamp');
  return value;
}
function validateOwners(agents: Pick<AgentRepository, 'list'>, mapping: LinearTaskMapping): void {
  const registered = new Set(agents.list().map((agent) => agent.id));
  if (Object.values(mapping.owners).some((agent) => !registered.has(agent)))
    throw new Error('Mapped Agent unavailable');
}
export async function readLinearCoreWorkItem(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  agents: Pick<AgentRepository, 'list'>,
  inputMapping: LinearTaskMapping,
  inputId: string,
): Promise<WorkItem> {
  const id = validateLinearIssueId(inputId),
    mapping = parseLinearTaskMapping(inputMapping);
  validateOwners(agents, mapping);
  const data = await queryLinear(
    request,
    secrets,
    'query KernelCoreWorkItem($id: String!) { issue(id: $id) { ' + coreFields + ' } }',
    { id },
  );
  validateOwners(agents, mapping);
  return parseCoreWorkItem(data.issue, mapping, id);
}
export async function listLinearCoreWorkItems(
  request: (url: string, init: RequestInit) => Promise<Response>,
  secrets: Pick<SecretStore, 'getSecret'>,
  agents: Pick<AgentRepository, 'list'>,
  inputMapping: LinearTaskMapping,
  input: LinearIssueListInput,
) {
  validateLinearIssueListInput(input);
  const mapping = parseLinearTaskMapping(inputMapping);
  validateOwners(agents, mapping);
  const data = await queryLinear(
    request,
    secrets,
    'query KernelCoreWorkItems($team: String!, $first: Int!, $after: String) { issues(first: $first, after: $after, filter: { team: { key: { eq: $team } } }) { nodes { ' +
      coreFields +
      ' } pageInfo { hasNextPage endCursor } } }',
    { team: input.team, first: input.limit, after: input.after ?? null },
  );
  validateOwners(agents, mapping);
  const page = parseLinearIssuePage(data.issues, input);
  if (!record(data.issues) || !Array.isArray(data.issues.nodes))
    throw new Error('Invalid Linear Core page');
  return {
    nodes: data.issues.nodes.map((value: unknown) => parseCoreWorkItem(value, mapping)),
    pageInfo: page.pageInfo,
  };
}
function parseCoreWorkItem(
  value: unknown,
  mapping: LinearTaskMapping,
  expectedId?: string,
): WorkItem {
  const issue = parseLinearUpdateIssue(value, ['stateId', 'assigneeId', 'labelIds']);
  if (expectedId !== undefined && issue.id !== expectedId && issue.identifier !== expectedId)
    throw new Error('Linear WorkItem identity conflict');
  const status =
    issue.fields?.stateId === undefined ? undefined : mapping.states[issue.fields.stateId];
  if (status === undefined) throw new Error('Unmapped Linear state');
  const assignee = issue.fields?.assigneeId;
  if (assignee === undefined) throw new Error('Missing Linear owner');
  const owner = assignee === null ? null : mapping.owners[assignee];
  if (owner === undefined) throw new Error('Unmapped Linear owner');
  if (
    !record(value) ||
    typeof value.priority !== 'number' ||
    !Number.isInteger(value.priority) ||
    value.priority < 0 ||
    value.priority > 4 ||
    !record(value.labels) ||
    !Array.isArray(value.labels.nodes)
  )
    throw new Error('Invalid Linear WorkItem fields');
  const labels = value.labels.nodes
    .map((label: unknown) => {
      if (!record(label) || typeof label.name !== 'string' || !label.name.trim())
        throw new Error('Invalid Linear label name');
      return label.name;
    })
    .sort();
  const createdAt = timestamp(value.createdAt),
    updatedAt = timestamp(value.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw new Error('Invalid Linear timestamp order');
  return {
    ...createTask(
      {
        title: issue.title,
        objective: issue.description?.trim() ? issue.description : issue.title,
        priority: value.priority,
        labels,
      },
      { id: 'linear:issue:' + issue.id, createdAt },
    ),
    kind: 'work_item',
    status,
    owner,
    externalRef: issue.url,
    updatedAt,
  };
}
