import { createApprovalDecision } from '../approvals/domain.js';
import type { Approval } from '../approvals/domain.js';
import { createApprovalRequest } from '../approvals/domain.js';
import { SqliteApprovalStore } from '../approvals/sqlite.js';
import { invokeApprovedWorkflow } from './approved.js';
import { KeychainSecretStore } from '../secrets/keychain.js';
import { EnvironmentSecretStore } from '../secrets/environment.js';
import type { SecretStore } from '../secrets/port.js';
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
      readonly action: 'run' | 'request-approval';
      readonly actor: string | null;
      readonly approvalId: string | null;
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
      approval: { type: 'string' },
      actor: { type: 'string' },
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
      parsed.values.approval !== undefined ||
      parsed.values.actor !== undefined ||
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
    if (
      parsed.values.key !== undefined ||
      parsed.values.input !== undefined ||
      parsed.values.approval !== undefined ||
      parsed.values.actor !== undefined
    )
      throw new Error('Unexpected Workflow observation options');
    return { ...base, action, target, config };
  }
  if (
    !['run', 'request-approval'].includes(action ?? '') ||
    !parsed.values.key?.trim() ||
    parsed.values.key.length > 128
  )
    throw new Error('Workflow run requires --key (1–128 characters)');
  const raw = parsed.values.input ?? '{}';
  if (Buffer.byteLength(raw) > 1048576) throw new Error('Workflow input size limit');
  let input: JsonObject;
  try {
    input = jsonObject(JSON.parse(raw));
  } catch {
    throw new Error('Workflow --input requires JSON object');
  }
  if (action !== 'run' && action !== 'request-approval') throw new Error('Invalid Workflow action');
  const actor = parsed.values.actor ?? null,
    approvalId = parsed.values.approval ?? null;
  if ((actor !== null && !actor.trim()) || (approvalId !== null && !approvalId.trim()))
    throw new Error('Invalid Workflow Approval options');
  if (action === 'request-approval' && (actor === null || approvalId !== null))
    throw new Error('Workflow request-approval requires --actor and no --approval');
  if (action === 'run' && (actor === null) !== (approvalId === null))
    throw new Error('Workflow approval requires both --actor and --approval');
  return { ...base, action, target, config, key: parsed.values.key, input, actor, approvalId };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function workflowSecretStore(value: Record<string, unknown>, actorId: string): SecretStore {
  const environment = value.apiKeyEnv,
    keychain = value.apiKeyKeychain;
  if ((environment === undefined) === (keychain === undefined))
    throw new Error('Workflow requires exactly one secret credential location');
  if (environment !== undefined) {
    if (typeof environment !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(environment))
      throw new Error(
        actorId === 'host:workflow'
          ? 'Invalid Workflow host config'
          : 'Invalid Agent Workflow scope',
      );
    return new EnvironmentSecretStore([
      { actorId, reference: 'n8n-api-key', environmentVariable: environment },
    ]);
  }
  if (
    !record(keychain) ||
    Object.keys(keychain).some((key) => !['path', 'service', 'account'].includes(key)) ||
    typeof keychain.path !== 'string' ||
    typeof keychain.service !== 'string' ||
    typeof keychain.account !== 'string'
  )
    throw new Error('Invalid Workflow Keychain credential');
  return new KeychainSecretStore([
    {
      actorId,
      reference: 'n8n-api-key',
      path: keychain.path,
      service: keychain.service,
      account: keychain.account,
    },
  ]);
}
export async function configuredWorkflowRuntime(path: string, secrets?: SecretStore) {
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
    Object.keys(value).some(
      (key) =>
        ![
          'baseUrl',
          'apiKeyEnv',
          'apiKeyKeychain',
          'workflows',
          'agentScopes',
          'taskWaitTimeoutMs',
        ].includes(key),
    ) ||
    typeof value.baseUrl !== 'string' ||
    !Array.isArray(value.workflows)
  )
    throw new Error('Invalid Workflow host config');
  const taskWaitTimeoutMs = value.taskWaitTimeoutMs ?? 30000;
  if (
    typeof taskWaitTimeoutMs !== 'number' ||
    !Number.isSafeInteger(taskWaitTimeoutMs) ||
    taskWaitTimeoutMs < 50 ||
    taskWaitTimeoutMs > 30000
  )
    throw new Error('Invalid Workflow Task wait timeout');
  const workflows = value.workflows.map(
    (
      workflow: unknown,
    ): { id: string; path: string; effect: 'read_only' | 'write' | 'irreversible' } => {
      if (
        !record(workflow) ||
        Object.keys(workflow).some((key) => !['id', 'path', 'effect'].includes(key)) ||
        typeof workflow.id !== 'string' ||
        typeof workflow.path !== 'string'
      )
        throw new Error('Invalid Workflow allowlist');
      const effect: unknown = workflow.effect ?? 'read_only';
      if (effect !== 'read_only' && effect !== 'write' && effect !== 'irreversible')
        throw new Error('Invalid Workflow effect');
      return { id: workflow.id, path: workflow.path, effect };
    },
  );
  const rawScopes: unknown = value.agentScopes ?? [];
  if (!Array.isArray(rawScopes)) throw new Error('Invalid Agent Workflow scopes');
  const agentIds = new Set<string>();
  const agentScopes = rawScopes.map((scope: unknown) => {
    if (
      !record(scope) ||
      Object.keys(scope).some(
        (key) => !['agentId', 'workflowIds', 'apiKeyEnv', 'apiKeyKeychain', 'effect'].includes(key),
      ) ||
      typeof scope.agentId !== 'string' ||
      !scope.agentId.trim() ||
      scope.agentId.length > 128 ||
      scope.agentId === 'host:workflow' ||
      !['read_only', 'write', 'irreversible'].includes(String(scope.effect)) ||
      !Array.isArray(scope.workflowIds) ||
      scope.workflowIds.some(
        (id: unknown) =>
          typeof id !== 'string' ||
          !workflows.some((workflow) => workflow.id === id && workflow.effect === scope.effect),
      )
    )
      throw new Error('Invalid Agent Workflow scope');
    if (agentIds.has(scope.agentId)) throw new Error('Duplicate Agent Workflow scope');
    agentIds.add(scope.agentId);
    const workflowIds = scope.workflowIds.map((id: unknown) => {
      if (typeof id !== 'string') throw new Error('Invalid scoped Workflow ID');
      return id;
    });
    if (new Set(workflowIds).size !== workflowIds.length)
      throw new Error('Duplicate scoped Workflow ID');
    return {
      effect: scope.effect,
      agentId: scope.agentId,
      secretStore: workflowSecretStore(scope, scope.agentId),
      workflowIds,
    };
  });
  const configuredSecrets = workflowSecretStore(value, 'host:workflow');
  const store = secrets ?? configuredSecrets;
  const apiKey = store.getSecret('host:workflow', 'n8n-api-key');
  const runtime = new N8nWorkflowRuntime(
    { baseUrl: value.baseUrl, apiKey, workflows },
    (url, init) => fetch(url, init),
  );
  const host = new URL(value.baseUrl).toString().replace(/\/$/, '');
  return {
    runtime,
    host,
    taskWaitTimeoutMs,
    workflows: workflows.map((workflow) => ({ ...workflow })),
    agentScopes: agentScopes.map((scope) => ({
      agentId: scope.agentId,
      effect: scope.effect,
      workflowIds: [...scope.workflowIds],
    })),
    approvedAgentRuntime: (
      agentId: string,
      workflowId: string,
      approval: Approval,
      signal?: AbortSignal,
    ) => {
      const { request, decision } = approval;
      if (!decision || decision.decision !== 'approve')
        throw new Error('Agent Workflow requires human Approval');
      createApprovalRequest(request, request);
      createApprovalDecision(request, decision, decision.createdAt);
      const scope = agentScopes.find(
        (candidate) => candidate.agentId === agentId && candidate.workflowIds.includes(workflowId),
      );
      const workflow = workflows.find((candidate) => candidate.id === workflowId);
      if (
        !scope ||
        !workflow ||
        workflow.effect === 'read_only' ||
        request.actor.kind !== 'agent' ||
        request.actor.id !== agentId ||
        request.taskId === null ||
        decision.approvalId !== request.id ||
        request.operation.kind !== 'workflow_invocation' ||
        request.operation.binding === undefined ||
        request.operation.host !== host ||
        request.operation.workflowId !== workflowId ||
        request.operation.effect !== workflow.effect ||
        scope.effect !== workflow.effect
      )
        throw new Error('Approved Agent Workflow scope denied');
      const scopedStore = secrets ?? scope.secretStore;
      const key = scopedStore.getSecret(agentId, 'n8n-api-key');
      return new N8nWorkflowRuntime(
        { baseUrl: host, apiKey: key, workflows: [workflow] },
        (url, init) =>
          fetch(url, {
            ...init,
            ...(signal === undefined
              ? {}
              : { signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) }),
          }),
      );
    },
    agentRuntime: (agentId: string, workflowId: string, signal?: AbortSignal) => {
      const scope = agentScopes.find(
        (candidate) => candidate.agentId === agentId && candidate.workflowIds.includes(workflowId),
      );
      const workflow = workflows.find((candidate) => candidate.id === workflowId);
      if (!scope || !workflow || workflow.effect !== 'read_only')
        throw new Error('Agent Workflow scope denied');
      const scopedStore = secrets ?? scope.secretStore;
      const apiKey = scopedStore.getSecret(agentId, 'n8n-api-key');
      return new N8nWorkflowRuntime({ baseUrl: host, apiKey, workflows: [workflow] }, (url, init) =>
        fetch(url, {
          ...init,
          ...(signal === undefined
            ? {}
            : { signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) }),
        }),
      );
    },
  };
}
export async function runWorkflowCommand(
  command: WorkflowCommand,
  output: (line: string) => void,
): Promise<void> {
  const configured =
    'config' in command ? await configuredWorkflowRuntime(command.config) : undefined;
  if (
    (command.action === 'run' || command.action === 'request-approval') &&
    !configured?.workflows.some((w) => w.id === command.target)
  )
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
      if (command.action === 'run' || command.action === 'request-approval') {
        const id =
          'workflow:request:' +
          createHash('sha256')
            .update(JSON.stringify([configured.host, command.target, command.key]))
            .digest('hex');
        const workflow = configured.workflows.find((w) => w.id === command.target);
        if (!workflow) throw new Error('Workflow is not allowed');
        const at = () => new Date().toISOString();
        if (command.action === 'request-approval') {
          if (workflow.effect === 'read_only' || command.actor === null)
            throw new Error('Workflow operation Approval requires write effect and actor');
          const store = new SqliteApprovalStore(command.db);
          try {
            result = store.requestOnce(
              createApprovalRequest(
                {
                  key: id,
                  actor: { kind: 'human', id: command.actor },
                  taskId: null,
                  eventId: null,
                  operation: {
                    kind: 'workflow_invocation',
                    host: configured.host,
                    workflowId: workflow.id,
                    inputDigest: createHash('sha256')
                      .update(JSON.stringify(command.input))
                      .digest('hex'),
                    requestId: id,
                    effect: workflow.effect,
                  },
                },
                { id: randomUUID(), createdAt: at() },
              ),
            );
          } finally {
            store.close();
          }
        } else if (workflow.effect !== 'read_only') {
          if (command.approvalId === null || command.actor === null)
            throw new Error('Workflow write operation requires human Approval');
          const store = new SqliteApprovalStore(command.db);
          try {
            result = await invokeApprovedWorkflow(
              store,
              bus,
              configured.runtime,
              {
                workflowId: workflow.id,
                host: configured.host,
                input: command.input,
                effect: workflow.effect,
                approvalId: command.approvalId,
                actor: { kind: 'human', id: command.actor },
              },
              { id, createdAt: at() },
              at,
            );
          } finally {
            store.close();
          }
        } else {
          if (command.approvalId !== null || command.actor !== null)
            throw new Error('Unexpected Approval for read_only Workflow');
          result = await invokeWorkflow(
            bus,
            configured.runtime,
            {
              workflowId: command.target,
              host: configured.host,
              input: command.input,
              inputDigest: createHash('sha256').update(JSON.stringify(command.input)).digest('hex'),
            },
            { id, createdAt: at() },
            at,
          );
        }
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
