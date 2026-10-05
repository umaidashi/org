import { SandboxCancelledError } from './domain.js';
export class SandboxJobs {
  private active:
    | {
        readonly taskId: string;
        readonly controller: AbortController;
        readonly completion: Promise<void>;
      }
    | undefined;
  private closed = false;
  async run(taskId: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.closed) throw new Error('Sandbox jobs are shut down');
    // ponytail: one Docker slot, use a bounded pool only when measured throughput requires it.
    if (this.active) throw new Error('Sandbox slot is busy');
    const controller = new AbortController();
    const completion = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new SandboxCancelledError('Sandbox execution cancelled');
      return work(controller.signal);
    });
    const job = { taskId, controller, completion };
    this.active = job;
    try {
      await completion;
    } finally {
      if (this.active === job) this.active = undefined;
    }
  }
  cancel(taskId: string): void {
    if (this.active?.taskId !== taskId) throw new Error('Sandbox Task is not running');
    this.active.controller.abort();
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    const job = this.active;
    if (!job) return;
    job.controller.abort();
    try {
      await job.completion;
    } catch (error) {
      if (!(error instanceof SandboxCancelledError)) throw error;
    }
  }
}
