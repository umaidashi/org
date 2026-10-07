import type { AgentRepository } from '../agents/port.js';
import type { SecretStore } from '../secrets/port.js';
import {
  createTask,
  isTaskStatus,
  parseProviderTaskPatch,
  type TaskStatus,
  type WorkItem,
} from '../tasks/domain.js';
import {
  parseLinearIssueFields,
  parseLinearUpdateIssue,
  type LinearIssueFields,
} from './fields.js';
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
  readonly labels?: Readonly<Record<string, string>>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseLinearTaskMapping(value: unknown): LinearTaskMapping {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['states', 'owners', 'labels'].includes(key)) ||
    !record(value.states) ||
    !record(value.owners) ||
    ('labels' in value && !record(value.labels))
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
  const labels =
    'labels' in value && record(value.labels)
      ? Object.fromEntries(
          Object.entries(value.labels).map(([name, id]) => {
            if (typeof id !== 'string' || !name.trim() || name.includes('\0') || name.length > 128)
              throw new Error('Invalid Linear label mapping');
            parseLinearIssueFields({ labelIds: [id] });
            return [name, id];
          }),
        )
      : undefined;
  if (labels !== undefined && Object.keys(labels).length > 100)
    throw new Error('Invalid Linear label mapping size');
  return { states, owners, ...(labels === undefined ? {} : { labels }) };
}
export function linearCoreTaskPatch(
  agents: Pick<AgentRepository, 'list'>,
  inputMapping: LinearTaskMapping,
  input: unknown,
): LinearIssueFields {
  const mapping = parseLinearTaskMapping(inputMapping),
    patch = parseProviderTaskPatch(input);
  validateOwners(agents, mapping);
  const reverse = (entries: Readonly<Record<string, string>>, value: string): string => {
    const found = Object.entries(entries).filter(([, candidate]) => candidate === value);
    if (found.length !== 1 || !found[0])
      throw new Error('Missing or ambiguous Linear Task mapping');
    return found[0][0];
  };
  const fields = {
    ...(patch.status === undefined ? {} : { stateId: reverse(mapping.states, patch.status) }),
    ...(patch.owner === undefined
      ? {}
      : { assigneeId: patch.owner === null ? null : reverse(mapping.owners, patch.owner) }),
    ...(patch.labels === undefined
      ? {}
      : {
          labelIds: patch.labels.map((name) => {
            const id = mapping.labels?.[name];
            if (typeof id !== 'string') throw new Error('Unmapped Linear label');
            return id;
          }),
        }),
    ...(patch.priority === undefined ? {} : { priority: patch.priority }),
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.objective === undefined ? {} : { description: patch.objective }),
  };
  return Object.keys(fields).length ? parseLinearIssueFields(fields) : {};
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
  const issue = parseLinearUpdateIssue(value, ['stateId', 'assigneeId', 'labelIds', 'priority']);
  if (expectedId !== undefined && issue.id !== expectedId && issue.identifier !== expectedId)
    throw new Error('Linear WorkItem identity conflict');
  const status =
    issue.fields?.stateId === undefined ? undefined : mapping.states[issue.fields.stateId];
  if (status === undefined) throw new Error('Unmapped Linear state');
  const assignee = issue.fields?.assigneeId;
  if (assignee === undefined) throw new Error('Missing Linear owner');
  const owner = assignee === null ? null : mapping.owners[assignee];
  if (owner === undefined) throw new Error('Unmapped Linear owner');
  const priority = issue.fields?.priority;
  if (priority === undefined) throw new Error('Missing Linear priority');
  if (!record(value) || !record(value.labels) || !Array.isArray(value.labels.nodes))
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
        priority,
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
