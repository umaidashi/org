import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Agent } from './domain.js';
import type { AgentRepository } from './port.js';

export class SqliteAgentRepository implements AgentRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        runtime TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  insert(agent: Agent): void {
    try {
      this.db
        .prepare(
          `INSERT INTO agents (id, name, role, runtime, created_at)
        VALUES (?, ?, ?, ?, ?)`,
        )
        .run(agent.id, agent.name, agent.role, agent.runtime, agent.createdAt);
    } catch (error) {
      if (error instanceof Error && 'errcode' in error && error.errcode === 2067) {
        throw new Error(`Agent ${JSON.stringify(agent.name)} already exists`, { cause: error });
      }
      throw error;
    }
  }

  list(): readonly Agent[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, role, runtime, created_at AS createdAt
      FROM agents ORDER BY name`,
      )
      .all();
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
      runtime: String(row.runtime),
      createdAt: String(row.createdAt),
    }));
  }

  close(): void {
    this.db.close();
  }
}
