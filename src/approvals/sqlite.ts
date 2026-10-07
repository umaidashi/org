import { parseTaskWorkflowBinding, parseLinearCommentOperation } from './domain.js';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createApprovalRequest, createApprovalDecision } from './domain.js';
import type {
  Approval,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalDecisionInput,
  WorkflowOperation,
  PermissionOperation,
  LinearCommentOperation,
} from './domain.js';
import type { ApprovalStore } from './port.js';
import { validateCapabilities } from '../agents/domain.js';
import type { Participant } from '../rooms/domain.js';
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid stored Approval');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored Approval text');
  return value;
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}
function actor(value: unknown): Participant {
  const row = object(value);
  if (row.kind !== 'human' && row.kind !== 'agent')
    throw new Error('Invalid stored Approval actor');
  return { kind: row.kind, id: text(row.id) };
}
function request(raw: unknown): ApprovalRequest {
  const row = object(JSON.parse(text(raw))),
    operation = object(row.operation);
  let parsed: WorkflowOperation | PermissionOperation | LinearCommentOperation;
  if (operation.kind === 'agent_capabilities' && typeof operation.expectedRevision === 'number')
    parsed = {
      kind: operation.kind,
      agentId: text(operation.agentId),
      expectedRevision: operation.expectedRevision,
      capabilities: validateCapabilities(operation.capabilities),
    };
  else if (
    operation.kind === 'workflow_invocation' &&
    (operation.effect === 'write' || operation.effect === 'irreversible')
  )
    parsed = {
      ...(operation.binding === undefined
        ? {}
        : { binding: parseTaskWorkflowBinding(operation.binding) }),
      kind: operation.kind,
      host: text(operation.host),
      workflowId: text(operation.workflowId),
      inputDigest: text(operation.inputDigest),
      requestId: text(operation.requestId),
      effect: operation.effect,
    };
  else if (operation.kind === 'linear_comment') parsed = parseLinearCommentOperation(operation);
  else throw new Error('Invalid stored Approval operation');
  return createApprovalRequest(
    {
      key: text(row.key),
      actor: actor(row.actor),
      taskId: nullable(row.taskId),
      eventId: nullable(row.eventId),
      operation: parsed,
    },
    { id: text(row.id), createdAt: text(row.createdAt) },
  );
}
function decision(raw: unknown, original: ApprovalRequest): ApprovalDecision {
  const row = object(JSON.parse(text(raw)));
  if ((row.decision !== 'approve' && row.decision !== 'reject') || row.approvalId !== original.id)
    throw new Error('Invalid stored Approval decision');
  return createApprovalDecision(
    original,
    { actor: actor(row.actor), decision: row.decision, reason: text(row.reason) },
    text(row.createdAt),
  );
}
export class SqliteApprovalStore implements ApprovalStore {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    try {
      this.db
        .transaction(() => {
          this.db
            .exec(`CREATE TABLE IF NOT EXISTS approval_requests(id TEXT PRIMARY KEY,idem_key TEXT NOT NULL UNIQUE,data TEXT NOT NULL) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS approval_decisions(approval_id TEXT PRIMARY KEY REFERENCES approval_requests(id),data TEXT NOT NULL) WITHOUT ROWID;`);
          for (const table of ['approval_requests', 'approval_decisions']) {
            const conflict =
              table === 'approval_requests'
                ? 'id=NEW.id OR idem_key=NEW.idem_key'
                : 'approval_id=NEW.approval_id';
            this.db
              .exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${conflict}) BEGIN SELECT RAISE(ABORT,'Approval records are immutable');END;
    CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Approval records are immutable');END;
    CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Approval records are immutable');END;`);
          }
        })
        .immediate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  requestOnce(input: ApprovalRequest): ApprovalRequest {
    input = createApprovalRequest(input, input);
    return this.db
      .transaction(() => {
        const row = this.db
          .query<{ data: string }, [string]>('SELECT data FROM approval_requests WHERE idem_key=?')
          .get(input.key);
        if (row) {
          const existing = request(row.data);
          const { id: _id, createdAt: _at, ...original } = existing;
          const { id: _new, createdAt: _now, ...retry } = input;
          if (!isDeepStrictEqual(original, retry)) throw new Error('Approval idempotency conflict');
          return existing;
        }
        this.db
          .query('INSERT INTO approval_requests(id,idem_key,data) VALUES(?,?,?)')
          .run(input.id, input.key, JSON.stringify(input));
        return input;
      })
      .immediate();
  }
  get(id: string): Approval {
    const row = this.db
      .query<{ data: string }, [string]>('SELECT data FROM approval_requests WHERE id=?')
      .get(id);
    if (!row) throw new Error('Approval not found');
    const original = request(row.data),
      record = this.db
        .query<{ data: string }, [string]>(
          'SELECT data FROM approval_decisions WHERE approval_id=?',
        )
        .get(id);
    return { request: original, decision: record ? decision(record.data, original) : null };
  }
  list(): readonly Approval[] {
    return this.db
      .query<{ id: string }, []>('SELECT id FROM approval_requests ORDER BY id')
      .all()
      .map((row) => this.get(row.id));
  }
  decide(id: string, input: ApprovalDecisionInput, at: string): Approval {
    return this.db
      .transaction(() => {
        const approval = this.get(id),
          next = createApprovalDecision(approval.request, input, at);
        if (approval.decision) {
          const { createdAt: _at, ...existing } = approval.decision;
          const { createdAt: _now, ...retry } = next;
          if (!isDeepStrictEqual(existing, retry)) throw new Error('Approval decision conflict');
          return approval;
        }
        this.db
          .query('INSERT INTO approval_decisions(approval_id,data) VALUES(?,?)')
          .run(id, JSON.stringify(next));
        return { ...approval, decision: next };
      })
      .immediate();
  }
  close(): void {
    this.db.close();
  }
}
