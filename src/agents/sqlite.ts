import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { changeReportingLine, createAgent, validateCapabilities } from './domain.js';
import type { Agent } from './domain.js';
import type { AgentRepository, AgentReportingWriter, ReportingHistory } from './port.js';

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored Agent reporting text');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

export class SqliteAgentRepository implements AgentRepository, AgentReportingWriter {
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

  insert(agent: Agent): void {
    agent = createAgent(agent, agent);
    try {
      this.transaction(() => {
        if (agent.reportsTo !== undefined)
          changeReportingLine([...this.list(), agent], agent.id, agent.reportsTo);
        this.db
          .prepare<Record<string, unknown>, (string | number | null)[]>(
            `INSERT INTO agents (id, name, role, runtime, created_at, reports_to, capabilities)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            agent.id,
            agent.name,
            agent.role,
            agent.runtime,
            agent.createdAt,
            agent.reportsTo ?? null,
            agent.capabilities === undefined ? null : JSON.stringify(agent.capabilities),
          );
        if (agent.reportsTo !== undefined)
          this.appendReporting(agent.id, null, agent.reportsTo, agent.createdAt);
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
        `SELECT id, name, role, runtime, created_at AS createdAt, reports_to AS reportsTo, capabilities
      FROM agents ORDER BY name`,
      )
      .all();
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
      runtime: String(row.runtime),
      createdAt: String(row.createdAt),
      ...(row.reportsTo === null ? {} : { reportsTo: text(row.reportsTo) }),
      ...(row.capabilities === null
        ? {}
        : { capabilities: validateCapabilities(JSON.parse(text(row.capabilities))) }),
    }));
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private appendReporting(
    id: string,
    previous: string | null,
    manager: string | null,
    at: string,
  ): void {
    if (!at.trim()) throw new Error('Reporting timestamp must not be empty');
    this.db
      .query(
        'INSERT INTO agent_reporting_history(agent_id,previous_manager,manager,at) VALUES(?,?,?,?)',
      )
      .run(id, previous, manager, at);
  }
  setReportsTo(id: string, manager: string | null, at: string): Agent {
    if (!at.trim()) throw new Error('Reporting timestamp must not be empty');
    return this.transaction(() => {
      const agents = this.list();
      const changed = changeReportingLine(agents, id, manager);
      const original = agents.find((agent) => agent.id === id);
      if (!original) throw new Error('Agent not found');
      if ((original.reportsTo ?? null) === manager) return changed;
      this.db.query('UPDATE agents SET reports_to=? WHERE id=?').run(manager, id);
      this.appendReporting(id, original.reportsTo ?? null, manager, at);
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

  close(): void {
    this.db.close();
  }
}
