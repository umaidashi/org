# org — AI Company Kernel

役割を持つ永続Agentが仕事を進める、ローカルファーストの運営基盤。
小さなe2eを確かめながら作る。現在はAgentの登録と一覧表示が利用できる。

## 導入

Python 3.11以上を使用する。実行時の外部依存はない。インストール時はsetuptoolsを取得するため、初回はネットワーク接続が必要になる場合がある。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

## Agentを登録・表示する

```sh
.venv/bin/org agent create cto --role CTO --runtime codex
.venv/bin/org agent create chief --role "Chief of Staff" --runtime claude-code
.venv/bin/org agent list
.venv/bin/org agent list --json
```

`source .venv/bin/activate` を実行すると `org agent list` のように呼び出せる。
runtimeは識別文字列として保存する。この段階ではCodexやClaudeなどの実行プロセスは起動しない。

AgentにはUUIDが付き、名前は一意。名前・役割・runtimeは空にできない。
名前は大文字小文字を区別し、前後の空白を含めて入力通りに保存する。
一覧は名前順。JSONでは `id`、`name`、`role`、`runtime`、UTCの `created_at` を取得できる。
正常終了は0、登録・保存エラーは1、引数のエラーは2。エラーは標準エラーへ出力する。

既定のDBは `~/.local/share/org/org.db`。別の保存先は **`agent` より前** に `--db` を指定する。
親ディレクトリとDBは初回に自動作成され、別プロセスから同じ登録情報を読める。

```sh
.venv/bin/org --db /tmp/org-demo/org.db agent create cto --role CTO --runtime codex
.venv/bin/org --db /tmp/org-demo/org.db agent list
```

## e2eを実行する

```sh
python3 -m unittest discover -s tests -v
```

標準ライブラリだけで実行できる。各テストは一時DBと一時HOMEを使い、CLIを別プロセスで起動する。
登録・永続化・名前順・空一覧・重複・空入力・保存失敗・日本語を含む値・既定パスを確認する。

インストールせず試す場合は `PYTHONPATH=src python3 -m org_kernel agent list` でも実行できる。

## 開発記録

- [設計書](docs/superpowers/specs/2026-10-04-agent-registry-design.md)
- [実装計画](docs/superpowers/plans/2026-10-04-agent-registry.md)
- [作業ログ](docs/work-log.md)

次の検証単位は、Taskの作成・取得・状態保存をCLIで一周させること。
