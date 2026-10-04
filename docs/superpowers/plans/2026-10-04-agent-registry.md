# Agent Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. この小さな一タスクはNative方式を推奨する。ユーザー承認によりNative方式で実行する。

**Goal:** AgentをSQLiteに登録し、別のCLIプロセスの `org agent list` から一覧を取得できるようにする。

**Architecture:** CLIは引数、表示、終了コードを扱い、AgentStoreはSQLiteへの保存と取得を扱う。外部runtimeはまだ起動せず、永続するAgentの情報だけを保存する。

**Tech Stack:** Python 3.11以上、argparse、sqlite3、uuid、unittest。実行時の外部依存なし。ビルドにはsetuptoolsを使う。

**Spec:** [承認済み設計書](../specs/2026-10-04-agent-registry-design.md)

## Global Constraints

- Agent IDはUUID。名前は一意で、重複登録は非ゼロ終了と明確なエラーにする。
- 名前・役割・runtimeは空文字を受け付けない。
- 一覧は名前の昇順とし、出力を安定させる。
- 既定の保存先は `~/.local/share/org/org.db`。`org --db PATH ...` で変更できる。
- 空の一覧は正常終了する。JSONでは `[]`、通常表示では未登録と分かるメッセージを出す。
- SQLiteのスキーマにはID、名前、役割、runtime、作成日時を保持する。日時はUTC。
- 保存失敗や重複は標準エラーへ報告し非ゼロ終了する。
- 最初のCLIにはLLMや外部サービスの呼び出しを含めない。
- 決定・変更・検証結果を `docs/work-log.md` に追記し、Gitへ記録する。

## Review Focus

1. 空白だけの名前・役割・runtime：登録が失敗しDBにレコードを追加しない。
2. 保存先の親ディレクトリがない：自動作成して登録できる。
3. 保存先が通常ファイルの下など書き込めない場所：tracebackを出さず非ゼロ終了する。
4. 引用符や日本語を含む名前：SQLとして解釈せず、同じ文字列を取得できる。
5. 既定パス：テストのHOMEを一時ディレクトリに隔離し、実際のユーザーDBに触れない。

---

## ファイル構成

- `pyproject.toml`：パッケージと `org` コマンドの定義。
- `src/org_kernel/__init__.py`：パッケージ。
- `src/org_kernel/__main__.py`：`python -m org_kernel` の起動点。
- `src/org_kernel/cli.py`：CLIの解析、表示、エラー。
- `src/org_kernel/agents.py`：Agent型とSQLiteのAgentStore。
- `tests/test_agent_cli.py`：別プロセスのCLIによるe2e。
- `README.md`：導入、利用、テストの実行方法。
- `.gitignore`：仮想環境、キャッシュ、ビルド成果物、ローカルDBの除外。
- `docs/work-log.md`：実行結果と完了・未完了事項。

### Task 1: 登録・一覧表示を一周させる

**Interfaces:**
- `Agent`：`id: str, name: str, role: str, runtime: str, created_at: str` を持つfrozen dataclass。
- `AgentStore(path: Path).create(name: str, role: str, runtime: str) -> Agent`。
- `AgentStore(path: Path).list() -> list[Agent]`。
- `cli.main(argv: list[str] | None = None) -> int`。
- モジュール起動点とインストール済み `org` は同じ `main` を呼ぶ。

- [x] **Step 1: e2eを先に書く**

`tests/test_agent_cli.py` では `unittest.TestCase`、`TemporaryDirectory`、`subprocess.run` を使用する。各テストで一時HOMEと一時DBを用意し、srcをPYTHONPATHに指定する。CLI起動helperの中核は次のコード。

```python
def run_cli(self, *args, default_db=False):
    prefix = [] if default_db else ['--db', str(self.db)]
    return subprocess.run(
        [sys.executable, '-m', 'org_kernel', *prefix, *args],
        env=self.env, text=True, capture_output=True, timeout=10,
    )
```

登録と別プロセスからの取得を次のように検証する。

```python
def test_persistent_agents(self):
    for name, role in [('cto', 'CTO'), ('chief', 'Chief of Staff')]:
        result = self.run_cli('agent', 'create', name,
                              '--role', role, '--runtime', 'codex')
        self.assertEqual(result.returncode, 0, result.stderr)
    first = self.run_cli('agent', 'list', '--json')
    self.assertEqual(first.returncode, 0, first.stderr)
    rows = json.loads(first.stdout)
    self.assertEqual([row['name'] for row in rows], ['chief', 'cto'])
    self.assertEqual([row['role'] for row in rows], ['Chief of Staff', 'CTO'])
    self.assertEqual([row['runtime'] for row in rows], ['codex', 'codex'])
    for row in rows:
        self.assertEqual(str(uuid.UUID(row['id'])), row['id'])
        self.assertIsNotNone(datetime.fromisoformat(row['created_at']).tzinfo)
    again = self.run_cli('agent', 'list', '--json')
    self.assertEqual(again.returncode, 0, again.stderr)
    self.assertEqual(json.loads(again.stdout), rows)
```

同じファイルで以下をそれぞれ実際のCLIから検証する。

- 空一覧：JSONが `[]`、通常表示が「No agents registered.」、終了コード0。
- 重複：同名の登録が非ゼロ終了しstderrに名前と `already exists`、一覧は元の一件のまま。
- 通常表示：ID、名前、役割、runtimeが表示される。
- 空白：名前、role、runtimeのそれぞれに `'   '` を渡すsubTestで非ゼロ終了、一覧は空。
- 親ディレクトリ：`temporary/nested/data/org.db` に登録・取得できる。
- 保存失敗：通常ファイル `temporary/blocker` を作り、DBを `blocker/org.db` に指定。非ゼロ終了、stderrに `Error:`、`Traceback` は含まれない。
- 名前の保存：`研究者'"` を登録しJSONからそのまま取得する。
- 既定パス：`default_db=True` で登録・取得し、一時HOMEの `.local/share/org/org.db` が存在する。

- [x] **Step 2: 未実装で失敗することを確かめる**

```sh
python3 -m unittest discover -s tests -v
```

期待：CLIがまだ存在しないため失敗する。失敗理由を作業ログに記録する。

- [x] **Step 3: AgentStoreとCLIを実装する**

`AgentStore` は接続ごとに次のテーブルを作る。接続はcontext managerでcommit/rollbackし、finallyでcloseする。

```sql
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    runtime TEXT NOT NULL,
    created_at TEXT NOT NULL
)
```

`create` は空白だけの値を `ValueError` で拒否し、UUIDと `datetime.now(timezone.utc).isoformat()` を生成する。元の非空文字列は保持する。挿入は次のパラメータ付きSQLを使う。

```python
connection.execute(
    'INSERT INTO agents (id, name, role, runtime, created_at) VALUES (?, ?, ?, ?, ?)',
    (agent.id, agent.name, agent.role, agent.runtime, agent.created_at),
)
```

同名の衝突は `sqlite3.IntegrityError` から `ValueError(f"Agent {name!r} already exists")` に変換する。一覧は `SELECT id, name, role, runtime, created_at FROM agents ORDER BY name` で取得する。

CLIの構造は次の通り。

```python
parser = argparse.ArgumentParser(prog='org')
parser.add_argument('--db', type=Path, default=Path.home() / '.local/share/org/org.db')
commands = parser.add_subparsers(dest='command', required=True)
agent = commands.add_parser('agent')
actions = agent.add_subparsers(dest='action', required=True)
create = actions.add_parser('create')
create.add_argument('name')
create.add_argument('--role', required=True)
create.add_argument('--runtime', required=True)
listing = actions.add_parser('list')
listing.add_argument('--json', action='store_true')
```

登録成功は `Created agent NAME (ID)`。通常一覧はID・名前・役割・runtimeの列をtabで区切る。JSONは `json.dumps([asdict(agent) for agent in agents], ensure_ascii=False)`。`OSError`、`sqlite3.Error`、`ValueError` はstderrに `Error: ...` と表示して1を返す。

パッケージの定義は次の内容。

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "org-kernel"
version = "0.1.0"
description = "Local-first AI Company Kernel"
requires-python = ">=3.11"
dependencies = []

[project.scripts]
org = "org_kernel.cli:main"

[tool.setuptools.packages.find]
where = ["src"]
```

`__main__.py` は `from .cli import main` と `raise SystemExit(main())`。`.gitignore` は `.venv/`、`__pycache__/`、`*.egg-info/`、`build/`、`dist/`、`*.db`、`*.db-shm`、`*.db-wal` を除外する。

- [x] **Step 4: e2eとインストール済みコマンドを検証する**

```sh
python3 -m unittest discover -s tests -v
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/org --help
```

一時ディレクトリのDBを指定して、インストール済み `.venv/bin/org` から登録→JSON一覧取得も実行する。通常のユーザーDBには触れない。成功したテスト数、コマンド、出力要約を作業ログに残す。インストールがネットワーク制約で失敗した場合は成功と記録せず、原因を解消するか未検証と明示する。

- [x] **Step 5: 利用方法をREADMEへ記録し差分をレビューする**

READMEには次を掲載する。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/org agent create cto --role CTO --runtime codex
.venv/bin/org agent list
.venv/bin/org agent list --json
python3 -m unittest discover -s tests -v
```

既定のDBパスと `--db` が `agent` より前に必要なことを記載する。runtimeは保存されるだけで、LLMの起動はまだないことを説明する。

差分を読み、設計の全項目とReview Focusの5項目を確認する。GitにDB・秘密情報・仮想環境が含まれていないことも確認する。

- [x] **Step 6: 変更と検証結果をGitへ記録する**

```sh
git add pyproject.toml src tests README.md .gitignore docs/work-log.md docs/superpowers/plans/2026-10-04-agent-registry.md
git commit -m 'feat: persist agents and list them through org CLI'
git status --short
```

作業ログと計画のチェックボックスを完了状態に更新してからコミットする。最後に実装範囲、検証結果、次の小さなe2e候補を報告する。

## 計画セルフレビュー

- 設計の登録・一覧・JSON・保存先・UUID・重複・空文字・空一覧・順序・UTC・エラー・README・e2eをTask 1に対応付けた。
- Review Focusの5条件をe2e対象に追加した。
- SQLiteのAgent型、Storeのメソッド、CLI起動点の名称を統一した。
- この段階でdaemon・LLM runtime・Memory・外部連携の実装は必要ない。
