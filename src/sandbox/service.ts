import { createEvent } from '../events/domain.js';
import type { EventBus } from '../events/port.js';
import type { Agent } from '../agents/domain.js';
import type { AgentRepository } from '../agents/port.js';
import type { RoomRepository } from '../rooms/port.js';
import type { Message } from '../rooms/domain.js';
import { parseSandboxProposal } from './proposal.js';
import type { Task, TaskArtifact } from '../tasks/domain.js';
import type { TaskProvider, ExecutionResultWriter } from '../tasks/port.js';
import { executeAssignedTask } from '../tasks/execution.js';
import type { ProcessResult } from '../runtime/process.js';
import {
  authorizeSandboxTask,
  SandboxCancelledError,
  type SandboxInput,
  type SandboxPolicy,
} from './domain.js';
export type SandboxAudit = {
  readonly events: Pick<EventBus, 'publish'>;
  readonly digest: (input: SandboxInput) => string;
};
export async function runSandboxTask(
  provider: Pick<TaskProvider, 'get' | 'update'> & ExecutionResultWriter,
  agent: Agent,
  run: (input: SandboxInput) => Promise<
    ProcessResult & {
      readonly files?: readonly { readonly path: string; readonly base64: string }[];
    }
  >,
  save: (bytes: Uint8Array) => Promise<string>,
  input: SandboxInput,
  taskId: string,
  now: () => string,
  id: () => string,
  proposalRef?: string,
  audit?: SandboxAudit,
): Promise<Task> {
  const original = provider.get(taskId);
  authorizeSandboxTask(original, agent, input);
  const result = await executeAssignedTask(provider, original, now, async (running) => {
    return produceSandboxArtifact(
      run,
      save,
      input,
      now,
      id,
      proposalRef,
      audit === undefined ? undefined : { ...audit, task: running },
    );
  });
  return result.task;
}

export async function produceSandboxArtifact(
  run: Parameters<typeof runSandboxTask>[2],
  save: Parameters<typeof runSandboxTask>[3],
  input: SandboxInput,
  now: () => string,
  id: () => string,
  proposalRef?: string,
  audit?: SandboxAudit & { readonly task: Task },
) {
  const task = audit?.task;
  if (
    task &&
    (task.kind !== 'execution_task' ||
      task.status !== 'running' ||
      task.owner === null ||
      !Number.isSafeInteger(task.version) ||
      task.version < 1)
  )
    throw new Error('Sandbox Audit requires owned running ExecutionTask');
  const requestId = task
    ? 'sandbox:' + encodeURIComponent(task.id) + ':' + task.version
    : undefined;
  const context = task
    ? {
        actorKind: 'agent',
        actorId: task.owner,
        taskId: task.id,
        taskVersion: task.version,
        eventId: task.externalRef?.startsWith('org:event:')
          ? task.externalRef.slice('org:event:'.length)
          : null,
        inputDigest: audit?.digest(input) ?? '',
        proposalRef: proposalRef ?? null,
        approvalId: null,
      }
    : undefined;
  if (context && !/^[a-f0-9]{64}$/.test(context.inputDigest))
    throw new Error('Invalid Sandbox Audit input digest');
  if (audit && requestId && context)
    audit.events.publish(
      createEvent(
        { type: 'sandbox.started', source: 'sandbox:docker', payload: context },
        { id: requestId, createdAt: now() },
      ),
    );
  const completed = (result: 'succeeded' | 'failed' | 'canceled', outputRef: string | null) => {
    if (audit && requestId && context)
      audit.events.publish(
        createEvent(
          {
            type: 'sandbox.completed',
            source: 'sandbox:docker',
            payload: { ...context, requestId, result, outputRef },
          },
          { id: requestId + ':completed', createdAt: now() },
        ),
      );
  };
  let produced;
  try {
    const output = await run(input);
    if (output.reason === 'cancelled')
      throw new SandboxCancelledError('Sandbox execution cancelled');
    if (output.reason !== 'exited' || output.exitCode !== 0)
      throw new Error(`Sandbox execution failed: ${output.reason}, exit ${output.exitCode}`);
    const content =
      input.files.length || proposalRef !== undefined
        ? JSON.stringify({
            ...(proposalRef === undefined ? {} : { proposalRef }),
            stdout: output.stdout,
            files: output.files ?? [],
          })
        : output.stdout;
    if (
      input.files.length &&
      (output.files?.length !== input.files.length ||
        output.files.some((file, index) => file.path !== input.files[index]))
    )
      throw new Error('Sandbox artifact result mismatch');
    const uri = await save(Buffer.from(content));
    produced = { result: output, artifact: { id: id(), uri, createdAt: now() } };
  } catch (error) {
    try {
      completed(error instanceof SandboxCancelledError ? 'canceled' : 'failed', null);
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Sandbox failed and Audit result could not be saved',
      );
    }
    throw error;
  }
  completed('succeeded', produced.artifact.uri);
  return produced;
}

export async function produceTaskSandboxArtifact(
  tasks: Pick<TaskProvider, 'get'>,
  agents: Pick<AgentRepository, 'list'>,
  rooms: Pick<RoomRepository, 'get'>,
  running: Task,
  message: Message,
  policy: SandboxPolicy,
  run: Parameters<typeof runSandboxTask>[2],
  save: Parameters<typeof runSandboxTask>[3],
  now: () => string,
  id: () => string,
  audit?: SandboxAudit,
): Promise<TaskArtifact> {
  const task = tasks.get(running.id);
  if (task.status !== 'running' || task.version !== running.version || task.owner !== running.owner)
    throw new Error('Sandbox requires current running Task version');
  const agent = agents.list().find((candidate) => candidate.id === task.owner);
  if (!agent) throw new Error('Task owner Agent not found');
  const input = {
    ...policy,
    code: parseSandboxProposal(task, rooms.get(message.roomId), message, running.version),
  };
  authorizeSandboxTask(task, agent, input, running.version);
  return (
    await produceSandboxArtifact(
      run,
      save,
      input,
      now,
      id,
      `org://rooms/${encodeURIComponent(message.roomId)}/messages/${encodeURIComponent(message.id)}`,
      audit === undefined ? undefined : { ...audit, task },
    )
  ).artifact;
}
