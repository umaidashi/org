import type { AuditActor, AuditEntry } from '../audit/domain.js';
import {
  createCapabilityChange,
  type CapabilitySnapshot,
  type CapabilityChange,
} from './permissions.js';
import { requireApprovedPermission, type ApprovedPermission } from '../approvals/domain.js';
import type { Participant } from '../rooms/domain.js';
import { jsonObject } from '../events/domain.js';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import {
  changeReportingLine,
  createAgent,
  validateCapabilities,
  validateMemoryPolicy,
} from './domain.js';
import type { Agent } from './domain.js';
import type {
  AgentRepository,
  AgentReportingWriter,
  AgentPermissionWriter,
  ReportingHistory,
} from './port.js';

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored Agent reporting text');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

export class SqliteAgentRepository
  implements AgentRepository, AgentReportingWriter, AgentPermissionWriter
{
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA busy_timeout = 5000');
    try {
      this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        runtime TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reports_to TEXT
      )`);
        const columns = this.db.query<{ name: string }, []>('PRAGMA table_info(agents)').all();
        if (!columns.some((column) => column.name === 'reports_to'))
          this.db.exec('ALTER TABLE agents ADD COLUMN reports_to TEXT');
        if (!columns.some((column) => column.name === 'capabilities'))
          this.db.exec('ALTER TABLE agents ADD COLUMN capabilities TEXT');
        if (!columns.some((column) => column.name === 'memory_policy'))
          this.db.exec('ALTER TABLE agents ADD COLUMN memory_policy TEXT');
        this.db
          .exec(`CREATE TABLE IF NOT EXISTS agent_capability_history(agent_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),approval_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,PRIMARY KEY(agent_id,revision)) WITHOUT ROWID;
        CREATE TRIGGER IF NOT EXISTS capability_no_replace BEFORE INSERT ON agent_capability_history WHEN EXISTS(SELECT 1 FROM agent_capability_history WHERE (agent_id=NEW.agent_id AND revision=NEW.revision) OR approval_id=NEW.approval_id) BEGIN SELECT RAISE(ABORT,'Capability history is immutable');END;
        CREATE TRIGGER IF NOT EXISTS capability_no_update BEFORE UPDATE ON agent_capability_history BEGIN SELECT RAISE(ABORT,'Capability history is immutable');END;
        CREATE TRIGGER IF NOT EXISTS capability_no_delete BEFORE DELETE ON agent_capability_history BEGIN SELECT RAISE(ABORT,'Capability history is immutable');END;`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS agent_configuration_history (
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL,
          actor_kind TEXT NOT NULL CHECK(actor_kind IN ('human','agent','system')),
          actor_id TEXT NOT NULL, tool TEXT NOT NULL CHECK(tool IN ('agent.register','agent.reporting.change')),
          input_ref TEXT NOT NULL, output_ref TEXT NOT NULL, at TEXT NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS agent_configuration_no_replace BEFORE INSERT ON agent_configuration_history
          WHEN EXISTS(SELECT 1 FROM agent_configuration_history WHERE id=NEW.id OR rowid=NEW.rowid)
          BEGIN SELECT RAISE(ABORT,'Agent configuration history is immutable');END;
        CREATE TRIGGER IF NOT EXISTS agent_configuration_no_update BEFORE UPDATE ON agent_configuration_history BEGIN SELECT RAISE(ABORT,'Agent configuration history is immutable');END;
        CREATE TRIGGER IF NOT EXISTS agent_configuration_no_delete BEFORE DELETE ON agent_configuration_history BEGIN SELECT RAISE(ABORT,'Agent configuration history is immutable');END;`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS agent_reporting_history (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
          previous_manager TEXT, manager TEXT, at TEXT NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS agent_reporting_no_replace BEFORE INSERT ON agent_reporting_history
          WHEN EXISTS(SELECT 1 FROM agent_reporting_history WHERE sequence=NEW.sequence OR rowid=NEW.rowid)
          BEGIN SELECT RAISE(ABORT,'Agent reporting history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS agent_reporting_no_update BEFORE UPDATE ON agent_reporting_history BEGIN SELECT RAISE(ABORT,'Agent reporting history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS agent_reporting_no_delete BEFORE DELETE ON agent_reporting_history BEGIN SELECT RAISE(ABORT,'Agent reporting history is immutable'); END;`);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  insert(agent: Agent, actor: AuditActor = { kind: 'system', id: 'unspecified' }): void {
    agent = createAgent(agent, agent);
    try {
      this.transaction(() => {
        if (agent.reportsTo !== undefined)
          changeReportingLine([...this.list(), agent], agent.id, agent.reportsTo);
        this.db
          .prepare<Record<string, unknown>, (string | number | null)[]>(
            `INSERT INTO agents (id, name, role, runtime, created_at, reports_to, capabilities, memory_policy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            agent.id,
            agent.name,
            agent.role,
            agent.runtime,
            agent.createdAt,
            agent.reportsTo ?? null,
            agent.capabilities === undefined ? null : JSON.stringify(agent.capabilities),
            agent.memoryPolicy ?? null,
          );
        if (agent.reportsTo !== undefined)
          this.appendReporting(agent.id, null, agent.reportsTo, agent.createdAt);
        this.appendConfiguration(
          'agent:' + encodeURIComponent(agent.id) + ':registration',
          agent.id,
          actor,
          'agent.register',
          `org://agents/${encodeURIComponent(agent.id)}`,
          `org://agents/${encodeURIComponent(agent.id)}`,
          agent.createdAt,
        );
      });
    } catch (error) {
      if (error instanceof Error && 'errno' in error && error.errno === 2067) {
        throw new Error(`Agent ${JSON.stringify(agent.name)} already exists`, { cause: error });
      }
      throw error;
    }
  }

  list(): readonly Agent[] {
    const rows = this.db
      .prepare<Record<string, unknown>, (string | number | null)[]>(
        `SELECT id, name, role, runtime, created_at AS createdAt, reports_to AS reportsTo, capabilities, memory_policy
      FROM agents ORDER BY name`,
      )
      .all();
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
      runtime: String(row.runtime),
      createdAt: String(row.createdAt),
      ...(row.memory_policy === null
        ? {}
        : { memoryPolicy: validateMemoryPolicy(row.memory_policy) }),
      ...(row.reportsTo === null ? {} : { reportsTo: text(row.reportsTo) }),
      ...(row.capabilities === null
        ? {}
        : { capabilities: validateCapabilities(JSON.parse(text(row.capabilities))) }),
    }));
  }
  private transaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }
  private appendReporting(
    id: string,
    previous: string | null,
    manager: string | null,
    at: string,
  ): number {
    if (!at.trim()) throw new Error('Reporting timestamp must not be empty');
    const result = this.db
      .query(
        'INSERT INTO agent_reporting_history(agent_id,previous_manager,manager,at) VALUES(?,?,?,?)',
      )
      .run(id, previous, manager, at);
    return Number(result.lastInsertRowid);
  }
  setReportsTo(
    id: string,
    manager: string | null,
    at: string,
    actor: AuditActor = { kind: 'system', id: 'unspecified' },
  ): Agent {
    if (!at.trim()) throw new Error('Reporting timestamp must not be empty');
    return this.transaction(() => {
      const agents = this.list();
      const changed = changeReportingLine(agents, id, manager);
      const original = agents.find((agent) => agent.id === id);
      if (!original) throw new Error('Agent not found');
      if ((original.reportsTo ?? null) === manager) return changed;
      this.db.query('UPDATE agents SET reports_to=? WHERE id=?').run(manager, id);
      const sequence = this.appendReporting(id, original.reportsTo ?? null, manager, at);
      this.appendConfiguration(
        'agent:' + encodeURIComponent(id) + ':reporting:' + sequence,
        id,
        actor,
        'agent.reporting.change',
        `org://agents/${encodeURIComponent(id)}`,
        `org://agents/${encodeURIComponent(id)}/reporting/${sequence}`,
        at,
      );
      return changed;
    });
  }
  reportingHistory(id: string): readonly ReportingHistory[] {
    if (!this.list().some((agent) => agent.id === id)) throw new Error('Agent not found');
    return this.db
      .query<Record<string, unknown>, [string]>(
        'SELECT * FROM agent_reporting_history WHERE agent_id=? ORDER BY sequence',
      )
      .all(id)
      .map((row) => ({
        sequence: Number(row.sequence),
        agentId: String(row.agent_id),
        previousManager: nullableText(row.previous_manager),
        manager: nullableText(row.manager),
        at: String(row.at),
      }));
  }

  private appendConfiguration(
    id: string,
    agentId: string,
    actor: AuditActor,
    tool: string,
    inputRef: string,
    outputRef: string,
    at: string,
  ): void {
    if (
      !['human', 'agent', 'system'].includes(actor.kind) ||
      !actor.id.trim() ||
      actor.id.includes('\0') ||
      actor.id.length > 128 ||
      !at.trim()
    )
      throw new Error('Invalid Agent configuration Audit actor/timestamp');
    this.db
      .query(
        'INSERT INTO agent_configuration_history(id,agent_id,actor_kind,actor_id,tool,input_ref,output_ref,at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(id, agentId, actor.kind, actor.id, tool, inputRef, outputRef, at);
  }
  configurationHistory(): readonly AuditEntry[] {
    return this.db
      .query<Record<string, unknown>, []>(
        'SELECT * FROM agent_configuration_history ORDER BY rowid',
      )
      .all()
      .map((row) => {
        const kind = text(row.actor_kind);
        if (kind !== 'human' && kind !== 'agent' && kind !== 'system')
          throw new Error('Invalid stored Agent configuration actor');
        return {
          id: text(row.id),
          causalId: `org://agents/${encodeURIComponent(text(row.agent_id))}`,
          actor: { kind, id: text(row.actor_id) },
          taskId: null,
          eventId: null,
          tool: text(row.tool),
          inputRef: text(row.input_ref),
          outputRef: text(row.output_ref),
          at: text(row.at),
          result: 'succeeded',
          approvalId: null,
        };
      });
  }

  capabilitySnapshot(id: string): CapabilitySnapshot {
    const row = this.db
      .query<{ capabilities: string | null; revision: number }, [string]>(`SELECT capabilities,
      COALESCE((SELECT MAX(revision) FROM agent_capability_history WHERE agent_id=agents.id),0) AS revision
      FROM agents WHERE id=?`)
      .get(id);
    if (!row) throw new Error('Agent not found');
    if (!Number.isSafeInteger(row.revision) || row.revision < 0)
      throw new Error('Invalid capability revision');
    return {
      agentId: id,
      revision: row.revision,
      capabilities:
        row.capabilities === null ? [] : validateCapabilities(JSON.parse(row.capabilities)),
    };
  }
  applyCapabilities(
    approved: ApprovedPermission,
    actor: Participant,
    at: string,
  ): CapabilityChange {
    requireApprovedPermission(approved);
    return this.transaction(() => {
      const row = this.db
        .query<{ data: string }, [string]>(
          'SELECT data FROM agent_capability_history WHERE approval_id=?',
        )
        .get(approved.request.id);
      if (row) {
        const existing = capabilityChange(row.data),
          operation = approved.request.operation;
        if (
          existing.agentId !== operation.agentId ||
          existing.revision !== operation.expectedRevision + 1 ||
          !isDeepStrictEqual(existing.capabilities, operation.capabilities)
        )
          throw new Error('Permission approval receipt conflict');
        return existing;
      }
      const next = createCapabilityChange(
        this.capabilitySnapshot(approved.request.operation.agentId),
        approved,
        actor,
        at,
      );
      this.db
        .query('UPDATE agents SET capabilities=? WHERE id=?')
        .run(JSON.stringify(next.capabilities), next.agentId);
      this.db
        .query(
          'INSERT INTO agent_capability_history(agent_id,revision,approval_id,data) VALUES(?,?,?,?)',
        )
        .run(next.agentId, next.revision, next.approvalId, JSON.stringify(next));
      return next;
    });
  }
  capabilityHistory(id?: string): readonly CapabilityChange[] {
    if (id !== undefined) this.capabilitySnapshot(id);
    const rows =
      id === undefined
        ? this.db
            .query<{ data: string }, []>(
              'SELECT data FROM agent_capability_history ORDER BY agent_id,revision',
            )
            .all()
        : this.db
            .query<{ data: string }, [string]>(
              'SELECT data FROM agent_capability_history WHERE agent_id=? ORDER BY revision',
            )
            .all(id);
    return rows.map((row) => capabilityChange(row.data));
  }

  close(): void {
    this.db.close();
  }
}

function capabilityChange(raw: unknown): CapabilityChange {
  const row = jsonObject(JSON.parse(text(raw))),
    actor = jsonObject(row.actor);
  if (
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    row.result !== 'applied' ||
    row.tool !== 'agent.capabilities.change' ||
    (actor.kind !== 'human' && actor.kind !== 'agent')
  )
    throw new Error('Invalid stored capability Audit');
  return {
    agentId: text(row.agentId),
    revision: row.revision,
    capabilities: validateCapabilities(row.capabilities),
    previousCapabilities: validateCapabilities(row.previousCapabilities),
    approvalId: text(row.approvalId),
    actor: { kind: actor.kind, id: text(actor.id) },
    taskId: nullableText(row.taskId),
    eventId: nullableText(row.eventId),
    tool: row.tool,
    inputRef: text(row.inputRef),
    outputRef: text(row.outputRef),
    at: text(row.at),
    result: row.result,
  };
}
