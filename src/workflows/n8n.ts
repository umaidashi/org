import { boundedJson } from '../runtime/http.js';
import type { WorkflowRuntime, WorkflowExecution, WorkflowStatus } from './port.js';
interface N8nConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workflows: readonly { readonly id: string; readonly path: string }[];
}
function executionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,63}$/.test(value))
    throw new Error('Invalid Workflow execution ID');
  return value;
}
function status(value: unknown): WorkflowStatus {
  switch (value) {
    case 'canceled':
    case 'crashed':
    case 'error':
    case 'new':
    case 'running':
    case 'success':
    case 'unknown':
    case 'waiting':
      return value;
    default:
      throw new Error('Invalid Workflow execution status');
  }
}
export class N8nWorkflowRuntime implements WorkflowRuntime {
  private readonly base: string;
  constructor(
    private readonly config: N8nConfig,
    private readonly request: (url: string, init: RequestInit) => Promise<Response>,
  ) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw new Error('Invalid Workflow host URL');
    }
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Workflow host requires HTTPS or loopback HTTP without credentials');
    if (!config.apiKey.trim() || config.apiKey.length > 4096 || /[\r\n]/.test(config.apiKey))
      throw new Error('Invalid Workflow API credential');
    if (new Set(config.workflows.map((w) => w.id)).size !== config.workflows.length)
      throw new Error('Duplicate Workflow IDs');
    for (const workflow of config.workflows)
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(workflow.id) ||
        !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(workflow.path) ||
        workflow.path.length > 256
      )
        throw new Error('Invalid Workflow allowlist');
    this.base = url.toString().replace(/\/$/, '');
  }
  private async json(
    path: string,
    method: 'GET' | 'POST',
    api: boolean,
    body?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (api) headers['X-N8N-API-KEY'] = this.config.apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.request(this.base + path, {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Workflow HTTP failure: ${response.status}`);
    }
    return boundedJson(response, 1048576);
  }
  async invoke(workflowId: string, input: unknown): Promise<string> {
    const workflow = this.config.workflows.find((w) => w.id === workflowId);
    if (!workflow) throw new Error('Workflow is not allowed');
    const body = JSON.stringify(input);
    if (body === undefined || Buffer.byteLength(body) > 1048576)
      throw new Error('Workflow input size limit');
    const value = await this.json('/webhook/' + workflow.path, 'POST', false, body);
    if (!value || typeof value !== 'object' || !('executionId' in value))
      throw new Error('Workflow webhook must return executionId');
    const id = executionId(value.executionId);
    if ((await this.status(id)).workflowId !== workflowId)
      throw new Error('Workflow invocation result mismatch');
    return id;
  }
  async status(id: string): Promise<WorkflowExecution> {
    executionId(id);
    const value = await this.json('/api/v1/executions/' + id + '?includeData=false', 'GET', true);
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      value.id !== id ||
      !('workflowId' in value) ||
      typeof value.workflowId !== 'string' ||
      !this.config.workflows.some((w) => w.id === value.workflowId) ||
      !('status' in value)
    )
      throw new Error('Workflow execution mismatch');
    return { id, workflowId: value.workflowId, status: status(value.status) };
  }
  async cancel(id: string): Promise<WorkflowStatus> {
    await this.status(id);
    const value = await this.json('/api/v1/executions/' + id + '/stop', 'POST', true);
    if (!value || typeof value !== 'object' || !('status' in value))
      throw new Error('Invalid Workflow stop response');
    return status(value.status);
  }
}
