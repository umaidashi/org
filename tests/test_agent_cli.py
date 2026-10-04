"""End-to-end checks against separate CLI processes and real SQLite files."""

from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid


class AgentCliTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.db = self.root / "org.db"
        self.env = dict(os.environ)
        self.env["HOME"] = str(self.root)
        self.env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")

    def run_cli(self, *args, default_db=False):
        prefix = [] if default_db else ["--db", str(self.db)]
        return subprocess.run(
            [sys.executable, "-m", "org_kernel", *prefix, *args],
            env=self.env, text=True, capture_output=True, timeout=10,
        )

    def create(self, name="cto", role="CTO", runtime="codex", **kwargs):
        return self.run_cli(
            "agent", "create", name, "--role", role, "--runtime", runtime, **kwargs,
        )

    def rows(self, **kwargs):
        result = self.run_cli("agent", "list", "--json", **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")

    def assert_error(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("Error:", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_empty_list(self):
        self.assertEqual(self.rows(), [])
        result = self.run_cli("agent", "list")
        self.assert_success(result)
        self.assertIn("No agents registered.", result.stdout)

    def test_persistent_agents(self):
        for name, role in [("cto", "CTO"), ("chief", "Chief of Staff")]:
            self.assert_success(self.create(name, role))
        rows = self.rows()
        self.assertEqual([row["name"] for row in rows], ["chief", "cto"])
        self.assertEqual([row["role"] for row in rows], ["Chief of Staff", "CTO"])
        self.assertEqual([row["runtime"] for row in rows], ["codex", "codex"])
        self.assertEqual(len({row["id"] for row in rows}), 2)
        for row in rows:
            self.assertEqual(str(uuid.UUID(row["id"])), row["id"])
            self.assertEqual(datetime.fromisoformat(row["created_at"]).utcoffset(), timedelta(0))
        self.assertEqual(self.rows(), rows)

    def test_duplicate_preserves_existing_agent(self):
        self.assert_success(self.create())
        original = self.rows()
        result = self.create(role="Changed", runtime="claude-code")
        self.assert_error(result)
        self.assertIn("cto", result.stderr)
        self.assertIn("already exists", result.stderr)
        self.assertEqual(self.rows(), original)

    def test_text_list_contains_registered_fields(self):
        self.assert_success(self.create())
        agent = self.rows()[0]
        result = self.run_cli("agent", "list")
        self.assert_success(result)
        self.assertIn("ID\tNAME\tROLE\tRUNTIME", result.stdout)
        self.assertIn(f"{agent['id']}\tcto\tCTO\tcodex", result.stdout)

    def test_rejects_empty_fields_without_registering(self):
        for field in ("name", "role", "runtime"):
            for value in ("", "   "):
                with self.subTest(field=field, value=value):
                    result = self.create(**{field: value})
                    self.assert_error(result)
                    self.assertIn(field, result.stderr)
                    self.assertEqual(self.rows(), [])

    def test_creates_missing_parent_directories(self):
        self.db = self.root / "nested" / "data" / "org.db"
        self.assert_success(self.create())
        self.assertTrue(self.db.is_file())
        self.assertEqual(self.rows()[0]["name"], "cto")

    def test_reports_storage_failure_without_traceback(self):
        blocker = self.root / "blocker"
        blocker.write_text("not a directory", encoding="utf-8")
        self.db = blocker / "org.db"
        self.assert_error(self.create())
        self.assert_error(self.run_cli("agent", "list", "--json"))

    def test_preserves_unicode_and_quotes(self):
        name = "研究者'\""
        self.assert_success(self.create(name, "調査", "claude-code"))
        agent = self.rows()[0]
        self.assertEqual(agent["name"], name)
        self.assertEqual(agent["role"], "調査")
        self.assertEqual(agent["runtime"], "claude-code")

    def test_default_database_is_under_isolated_home(self):
        self.assert_success(self.create(default_db=True))
        self.assertEqual(self.rows(default_db=True)[0]["name"], "cto")
        self.assertTrue((self.root / ".local/share/org/org.db").is_file())
        self.assertFalse(self.db.exists())


if __name__ == "__main__":
    unittest.main()
