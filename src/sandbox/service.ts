import type { Agent } from '../agents/domain.js';
import type { Task } from '../tasks/domain.js';
import type { TaskProvider, ExecutionResultWriter } from '../tasks/port.js';
import { executeAssignedTask } from '../tasks/execution.js';
import type { ProcessResult } from '../runtime/process.js';
import { authorizeSandboxTask, SandboxCancelledError, type SandboxInput } from './domain.js';
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
): Promise<Task> {
  const original = provider.get(taskId);
  authorizeSandboxTask(original, agent, input);
  const result = await executeAssignedTask(provider, original, now, async () => {
    const output = await run(input);
    if (output.reason === 'cancelled')
      throw new SandboxCancelledError('Sandbox execution cancelled');
    if (output.reason !== 'exited' || output.exitCode !== 0)
      throw new Error(`Sandbox execution failed: ${output.reason}, exit ${output.exitCode}`);
    const content = input.files.length
      ? JSON.stringify({ stdout: output.stdout, files: output.files ?? [] })
      : output.stdout;
    if (
      input.files.length &&
      (output.files?.length !== input.files.length ||
        output.files.some((file, index) => file.path !== input.files[index]))
    )
      throw new Error('Sandbox artifact result mismatch');
    const uri = await save(Buffer.from(content));
    return { result: output, artifact: { id: id(), uri, createdAt: now() } };
  });
  return result.task;
}
