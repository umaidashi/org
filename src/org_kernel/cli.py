"""CLI entry point for the local Agent registry."""

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sqlite3
import sys

from .agents import AgentStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="org", description="Local-first AI Company Kernel")
    parser.add_argument(
        "--db", type=Path, default=Path.home() / ".local/share/org/org.db",
        help="SQLite database path (default: ~/.local/share/org/org.db)",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    agent = commands.add_parser("agent", help="Register and list Agent identities")
    actions = agent.add_subparsers(dest="action", required=True)
    create = actions.add_parser("create", help="Register an Agent")
    create.add_argument("name")
    create.add_argument("--role", required=True)
    create.add_argument("--runtime", required=True)
    listing = actions.add_parser("list", help="List registered Agents")
    listing.add_argument("--json", action="store_true", help="Output a JSON array")
    args = parser.parse_args(argv)

    try:
        store = AgentStore(args.db)
        if args.action == "create":
            registered = store.create(args.name, args.role, args.runtime)
            print(f"Created agent {registered.name} ({registered.id})")
        else:
            agents = store.list()
            if args.json:
                print(json.dumps([asdict(agent) for agent in agents], ensure_ascii=False))
            elif not agents:
                print("No agents registered.")
            else:
                print("ID\tNAME\tROLE\tRUNTIME")
                for agent in agents:
                    print(f"{agent.id}\t{agent.name}\t{agent.role}\t{agent.runtime}")
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0
