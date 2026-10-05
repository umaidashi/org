export type WorkflowStatus =
  | 'canceled'
  | 'crashed'
  | 'error'
  | 'new'
  | 'running'
  | 'success'
  | 'unknown'
  | 'waiting';
export interface WorkflowExecution {
  readonly id: string;
  readonly workflowId: string;
  readonly status: WorkflowStatus;
}
export interface WorkflowRuntime {
  invoke(workflowId: string, input: unknown): Promise<string>;
  status(executionId: string): Promise<WorkflowExecution>;
  cancel(executionId: string): Promise<WorkflowStatus>;
}
