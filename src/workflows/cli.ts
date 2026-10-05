import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { jsonObject, type JsonObject } from '../events/domain.js';
import { SqliteEventBus } from '../events/sqlite.js';
import { N8nWorkflowRuntime } from './n8n.js';
import { invokeWorkflow, observeWorkflow } from './service.js';
export type WorkflowCommand = { readonly db: string; readonly json: boolean } & (
  | {
      readonly action: 'run';
      readonly target: string;
      readonly key: string;
      readonly input: JsonObject;
      readonly config: string;
    }
  | { readonly action: 'status' | 'cancel'; readonly target: string; readonly config: string }
  | { readonly action: 'list' }
  | { readonly action: 'history'; readonly target: string }
);
export function parseWorkflowCommand(argv: string[]): WorkflowCommand {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      config: { type: 'string' },
      key: { type: 'string' },
      input: { type: 'string' },
    },
  });
  const [noun, action, target, ...extra] = parsed.positionals;
  if (noun !== 'workflow' || extra.length)
    throw new Error('Expected workflow run|status|cancel|list|history');
  const db = parsed.values.db ?? join(homedir(), '.local', 'share', 'org', 'org.db');
  if (!db.trim() || db === ':memory:') throw new Error('Workflow requires persistent DB');
  const base = { db, json: parsed.values.json ?? false };
  if (action === 'list' || action === 'history') {
    if (
      parsed.values.config !== undefined ||
      parsed.values.key !== undefined ||
      parsed.values.input !== undefined ||
      (action === 'list' ? target !== undefined : !target?.trim())
    )
      throw new Error('Unexpected Workflow listing options');
    return action === 'list' ? { ...base, action } : { ...base, action, target: target ?? '' };
  }
  if (!target?.trim() || !parsed.values.config?.trim())
    throw new Error('Workflow target and --config required');
  const config = resolve(parsed.values.config);
  if (action === 'status' || action === 'cancel') {
    if (parsed.values.key !== undefined || parsed.values.input !== undefined)
      throw new Error('Unexpected Workflow observation options');
    return { ...base, action, target, config };
  }
  if (action !== 'run' || !parsed.values.key?.trim() || parsed.values.key.length > 128)
    throw new Error('Workflow run requires --key (1–128 characters)');
  const raw = parsed.values.input ?? '{}';
  if (Buffer.byteLength(raw) > 1048576) throw new Error('Workflow input size limit');
  let input: JsonObject;
  try {
    input = jsonObject(JSON.parse(raw));
  } catch {
    throw new Error('Workflow --input requires JSON object');
  }
  return { ...base, action, target, config, key: parsed.values.key, input };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export async function configuredWorkflowRuntime(path: string) {
  const file = Bun.file(path);
  if (file.size > 65536) throw new Error('Workflow config size limit');
  let value: unknown;
  try {
    value = await file.json();
  } catch {
    throw new Error('Cannot read Workflow config JSON');
  }
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['baseUrl', 'apiKeyEnv', 'workflows'].includes(key)) ||
    typeof value.baseUrl !== 'string' ||
    typeof value.apiKeyEnv !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.apiKeyEnv) ||
    !Array.isArray(value.workflows)
  )
    throw new Error('Invalid Workflow host config');
  const workflows = value.workflows.map((workflow: unknown) => {
    if (
      !record(workflow) ||
      Object.keys(workflow).some((key) => !['id', 'path'].includes(key)) ||
      typeof workflow.id !== 'string' ||
      typeof workflow.path !== 'string'
    )
      throw new Error('Invalid Workflow allowlist');
    return { id: workflow.id, path: workflow.path };
  });
  const apiKey = process.env[value.apiKeyEnv];
  if (apiKey === undefined) throw new Error('Workflow API credential environment variable missing');
  const runtime = new N8nWorkflowRuntime(
    { baseUrl: value.baseUrl, apiKey, workflows },
    (url, init) => fetch(url, init),
  );
  const host = new URL(value.baseUrl).toString().replace(/\/$/, '');
  return { runtime, host, workflows };
}
export async function runWorkflowCommand(
  command: WorkflowCommand,
  output: (line: string) => void,
): Promise<void> {
  const configured =
    'config' in command ? await configuredWorkflowRuntime(command.config) : undefined;
  if (command.action === 'run' && !configured?.workflows.some((w) => w.id === command.target))
    throw new Error('Workflow is not allowed');
  const bus = new SqliteEventBus(command.db);
  try {
    let result: unknown;
    if (command.action === 'list' || command.action === 'history') {
      // ponytail: scan existing immutable Events; add an indexed query after measured receipt volume warrants it.
      result = bus
        .list()
        .filter(
          (event) =>
            event.source === 'workflow:n8n' &&
            (command.action === 'list'
              ? event.type === 'workflow.requested'
              : event.id === command.target || event.payload.requestId === command.target),
        );
    } else {
      if (!configured) throw new Error('Workflow host config missing');
      if (command.action === 'run') {
        const id =
          'workflow:request:' +
          createHash('sha256')
            .update(JSON.stringify([configured.host, command.target, command.key]))
            .digest('hex');
        result = await invokeWorkflow(
          bus,
          configured.runtime,
          {
            workflowId: command.target,
            host: configured.host,
            input: command.input,
            inputDigest: createHash('sha256').update(JSON.stringify(command.input)).digest('hex'),
          },
          { id, createdAt: new Date().toISOString() },
          () => new Date().toISOString(),
        );
      } else
        result = await observeWorkflow(
          bus,
          configured.runtime,
          command.target,
          configured.host,
          command.action,
          { id: randomUUID(), createdAt: new Date().toISOString() },
        );
    }
    output(JSON.stringify(result, null, command.json ? undefined : 2));
  } finally {
    bus.close();
  }
}
