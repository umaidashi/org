export const taskStatuses = [
  'pending',
  'assigned',
  'running',
  'blocked',
  'waiting_approval',
  'completed',
  'failed',
] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export type TaskKind = 'work_item' | 'execution_task';
export interface Task {
  readonly id: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly objective: string;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly owner: string | null;
  readonly parentId: string | null;
  readonly dependencies: readonly string[];
  readonly labels: readonly string[];
  readonly inputArtifacts: readonly string[];
  readonly outputArtifacts: readonly string[];
  readonly externalRef: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type WorkItem = Task & { readonly kind: 'work_item' };
export type ExecutionTask = Task & { readonly kind: 'execution_task' };
export interface TaskComment {
  readonly id: string;
  readonly body: string;
  readonly actor: string;
  readonly createdAt: string;
}
export interface TaskArtifact {
  readonly id: string;
  readonly uri: string;
  readonly createdAt: string;
}
export function attachArtifact(
  task: Task,
  artifact: TaskArtifact,
  direction: 'input' | 'output',
): Task {
  for (const value of [artifact.id, artifact.uri, artifact.createdAt]) {
    if (!value.trim()) throw new Error('Artifact fields must not be empty');
  }
  const field = direction === 'input' ? 'inputArtifacts' : 'outputArtifacts';
  if (task[field].includes(artifact.id)) throw new Error('Artifact already linked');
  return {
    ...task,
    [field]: [...task[field], artifact.id],
    version: task.version + 1,
    updatedAt: artifact.createdAt,
  };
}
export interface TaskInput {
  readonly title: string;
  readonly objective: string;
  readonly kind?: TaskKind;
  readonly priority?: number;
  readonly parentId?: string;
  readonly dependencies?: readonly string[];
  readonly labels?: readonly string[];
}
export interface TaskPatch {
  readonly title?: string;
  readonly objective?: string;
  readonly status?: TaskStatus;
  readonly owner?: string;
  readonly priority?: number;
  readonly parentId?: string | null;
  readonly dependencies?: readonly string[];
  readonly labels?: readonly string[];
}
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && taskStatuses.some((status) => status === value);
}
const transitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['assigned', 'failed'],
  assigned: ['running', 'blocked', 'failed'],
  running: ['blocked', 'waiting_approval', 'completed', 'failed'],
  blocked: ['assigned', 'running', 'waiting_approval', 'failed'],
  waiting_approval: ['running', 'completed', 'failed'],
  completed: [],
  failed: [],
};
function validateTask(task: Task): void {
  for (const field of ['id', 'title', 'objective', 'createdAt', 'updatedAt'] as const) {
    if (!task[field].trim()) throw new Error(`Task ${field} must not be empty`);
  }
  if (!Number.isInteger(task.priority) || task.priority < 0)
    throw new Error('Priority must be a nonnegative integer');
  if (task.owner !== null && !task.owner.trim()) throw new Error('Owner must not be empty');
  if (task.status !== 'pending' && task.status !== 'failed' && task.owner === null)
    throw new Error('Task state requires an owner');
  for (const values of [
    task.dependencies,
    task.labels,
    task.inputArtifacts,
    task.outputArtifacts,
  ]) {
    if (values.some((value) => !value.trim()))
      throw new Error('Task references and labels must not be empty');
    if (new Set(values).size !== values.length)
      throw new Error('Duplicate task references or labels');
  }
}
export function createTask(
  input: TaskInput,
  identity: { readonly id: string; readonly createdAt: string },
): Task {
  const task: Task = {
    ...identity,
    title: input.title,
    objective: input.objective,
    kind: input.kind ?? 'work_item',
    status: 'pending',
    owner: null,
    priority: input.priority ?? 0,
    parentId: input.parentId ?? null,
    dependencies: [...(input.dependencies ?? [])],
    labels: [...(input.labels ?? [])],
    inputArtifacts: [],
    outputArtifacts: [],
    externalRef: null,
    version: 0,
    updatedAt: identity.createdAt,
  };
  validateTask(task);
  return task;
}
export function changeTask(task: Task, patch: TaskPatch, at: string): Task {
  const status =
    patch.owner !== undefined && task.status === 'pending'
      ? 'assigned'
      : (patch.status ?? task.status);
  if (patch.owner !== undefined && patch.status !== undefined && patch.status !== status)
    throw new Error('Conflicting assignment state');
  if (status !== task.status && !transitions[task.status].includes(status))
    throw new Error(`Invalid transition ${task.status} -> ${status}`);
  if ((task.status === 'completed' || task.status === 'failed') && Object.keys(patch).length > 0)
    throw new Error('Terminal task is immutable');
  const changed: Task = {
    ...task,
    ...patch,
    status,
    dependencies: [...(patch.dependencies ?? task.dependencies)],
    labels: [...(patch.labels ?? task.labels)],
    version: task.version + 1,
    updatedAt: at,
  };
  validateTask(changed);
  return changed;
}

export function validateTaskReferences(task: Task, tasks: readonly Task[]): void {
  const graph = new Map(tasks.map((node) => [node.id, node]));
  graph.set(task.id, task);
  function get(id: string): Task {
    const node = graph.get(id);
    if (!node) throw new Error(`Task ${JSON.stringify(id)} not found`);
    return node;
  }
  let parent = task.parentId;
  const parents = new Set([task.id]);
  while (parent !== null) {
    if (parents.has(parent)) throw new Error('Parent cycle');
    parents.add(parent);
    parent = get(parent).parentId;
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: { id: string; exit: boolean }[] = [{ id: task.id, exit: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) throw new Error('Invalid traversal state');
    if (entry.exit) {
      active.delete(entry.id);
      visited.add(entry.id);
      continue;
    }
    if (active.has(entry.id)) throw new Error('Dependency cycle');
    if (visited.has(entry.id)) continue;
    active.add(entry.id);
    const node = get(entry.id);
    stack.push({ id: entry.id, exit: true });
    for (const dependency of node.dependencies) stack.push({ id: dependency, exit: false });
  }
  if (task.status === 'running' || task.status === 'completed') {
    for (const id of task.dependencies)
      if (get(id).status !== 'completed') throw new Error('Task dependencies are not completed');
  }
}
