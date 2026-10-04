"""Persistent Agent identities, independent of execution runtimes."""

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from typing import Iterator
from uuid import uuid4


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    role: str
    runtime: str
    created_at: str


class AgentStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        try:
            with connection:
                connection.execute(
                    """CREATE TABLE IF NOT EXISTS agents (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL UNIQUE,
                        role TEXT NOT NULL,
                        runtime TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )"""
                )
                yield connection
        finally:
            connection.close()

    def create(self, name: str, role: str, runtime: str) -> Agent:
        for field, value in (("name", name), ("role", role), ("runtime", runtime)):
            if not value.strip():
                raise ValueError(f"Agent {field} must not be empty")
        agent = Agent(str(uuid4()), name, role, runtime, datetime.now(timezone.utc).isoformat())
        try:
            with self._connection() as connection:
                connection.execute(
                    "INSERT INTO agents (id, name, role, runtime, created_at) VALUES (?, ?, ?, ?, ?)",
                    (agent.id, agent.name, agent.role, agent.runtime, agent.created_at),
                )
        except sqlite3.IntegrityError as error:
            if error.sqlite_errorname == "SQLITE_CONSTRAINT_UNIQUE":
                raise ValueError(f"Agent {name!r} already exists") from error
            raise
        return agent

    def list(self) -> list[Agent]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT id, name, role, runtime, created_at FROM agents ORDER BY name"
            ).fetchall()
        return [Agent(*row) for row in rows]
