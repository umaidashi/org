import { createEvent, type Event, type Identity, type JsonObject } from '../events/domain.js';
import type { EventBus } from '../events/port.js';
import type { WorkflowRuntime } from './port.js';
export async function invokeWorkflow(
  bus: Pick<EventBus, 'publish'>,
  runtime: Pick<WorkflowRuntime, 'invoke'>,
  input: {
    readonly workflowId: string;
    readonly host: string;
    readonly input: JsonObject;
    readonly inputDigest: string;
    readonly context?: {
      readonly actorId: string;
      readonly taskId: string | null;
      readonly proposalRef: string | null;
      readonly approvalId: string | null;
      readonly effect: 'read_only' | 'write' | 'irreversible';
    };
  },
  identity: Identity,
  now: () => string,
): Promise<Event> {
  const payload = {
    workflowId: input.workflowId,
    host: input.host,
    inputDigest: input.inputDigest,
    ...(input.context === undefined
      ? {}
      : {
          actorId: input.context.actorId,
          taskId: input.context.taskId,
          proposalRef: input.context.proposalRef,
          approvalId: input.context.approvalId,
          effect: input.context.effect,
        }),
  };
  // The immutable claim precedes the external effect; a duplicate publish must stop invocation.
  bus.publish(
    createEvent({ type: 'workflow.requested', source: 'workflow:n8n', payload }, identity),
  );
  try {
    const executionId = await runtime.invoke(input.workflowId, input.input);
    return bus.publish(
      createEvent(
        {
          type: 'workflow.started',
          source: 'workflow:n8n',
          payload: { ...payload, requestId: identity.id, executionId },
        },
        { id: identity.id + ':started', createdAt: now() },
      ),
    );
  } catch (error) {
    try {
      bus.publish(
        createEvent(
          {
            type: 'workflow.unconfirmed',
            source: 'workflow:n8n',
            payload: { ...payload, requestId: identity.id },
          },
          { id: identity.id + ':unconfirmed', createdAt: now() },
        ),
      );
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        'Workflow invocation outcome and receipt are unconfirmed',
      );
    }
    throw error;
  }
}
export async function observeWorkflow(
  bus: Pick<EventBus, 'get' | 'publish'>,
  runtime: Pick<WorkflowRuntime, 'status' | 'cancel'>,
  requestId: string,
  host: string,
  action: 'status' | 'cancel',
  identity: Identity,
): Promise<Event> {
  const requested = bus.get(requestId),
    started = bus.get(requestId + ':started');
  if (
    requested.type !== 'workflow.requested' ||
    requested.source !== 'workflow:n8n' ||
    started.type !== 'workflow.started' ||
    started.source !== requested.source ||
    requested.payload.host !== host ||
    started.payload.host !== host ||
    started.payload.requestId !== requestId ||
    started.payload.workflowId !== requested.payload.workflowId ||
    typeof started.payload.executionId !== 'string'
  )
    throw new Error('Workflow receipt host or execution mismatch');
  const execution = await runtime.status(started.payload.executionId);
  if (
    execution.id !== started.payload.executionId ||
    execution.workflowId !== requested.payload.workflowId
  )
    throw new Error('Workflow receipt result mismatch');
  const status = action === 'cancel' ? await runtime.cancel(execution.id) : execution.status;
  return bus.publish(
    createEvent(
      {
        type: action === 'cancel' ? 'workflow.cancel_observed' : 'workflow.status_observed',
        source: 'workflow:n8n',
        payload: {
          requestId,
          host,
          workflowId: execution.workflowId,
          executionId: execution.id,
          status,
        },
      },
      identity,
    ),
  );
}
