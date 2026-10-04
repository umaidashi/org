# org — AI Company Kernel

役割と記憶を持つ永続Agentが仕事を進める、ローカルファーストの運営基盤。TypeScriptで、小さなe2eを確かめながら作る。現在はAgentの登録と一覧表示が利用できる。全体の未完了項目は [要件照合](docs/requirements.md) で追跡する。

## セットアップ

Node 24以上とnpmを使用する。開発用Node 24もdevDependencyとして固定しているため、npm scriptsは同じランタイムで動く。

```sh
npm ci
npm run build
npm run hooks:install
```

## Agentを登録・表示する

```sh
npm start -- agent create cto --role CTO --runtime codex
npm start -- agent create chief --role "Chief of Staff" --runtime claude-code
npm start -- agent list
npm start -- agent list --json
```

ビルドしたCLIを直接実行する場合は `./dist/src/cli.js agent list`。インストールしたパッケージのbin名は `org`。runtimeは識別文字列として保存し、この段階ではCodexやClaudeを起動しない。

AgentにはUUIDが付き、名前は一意。名前・役割・runtimeは空にできない。名前は大文字小文字を区別し、前後の空白を含め入力通りに保存する。一覧は名前順。JSONは初期版の契約を保ち、`id`、`name`、`role`、`runtime`、UTCの `created_at` を返す。

既定DBは `~/.local/share/org/org.db`。親ディレクトリを自動作成し、別プロセスから同じAgentを取得できる。初期Python版のSQLite schemaとデータはそのまま読める。

```sh
npm start -- --db /tmp/org-demo/org.db agent create cto --role CTO --runtime codex
npm start -- --db /tmp/org-demo/org.db agent list
```

正常終了は0、保存・入力値エラーは1、引数エラーは2。エラーはstderr。Node標準のSQLiteを使い、実行時の外部依存はない。CLI起動では既知のExperimentalWarningを抑制している。古いPython用 `.venv` は現在の開発では使わない。

## テスト・生成物レビュー

```sh
npm run check           # 型・lint・format・AST・unit/integration/e2e・jev dry-run
npm run test:e2e
npm run review:plan     # 外部送信前の対象と見積もり
npm run review:semantic # .envまたは環境変数のキーで実際の意味レビュー
```

検査は全てローカル。GitHub Actionsは使わない。Lefthookのpre-commitでステージ済み内容の静的検査、pre-pushでpush対象commitの全検査と意味レビューを行う。pushをせずHEADを検査する場合は `npm run verify:head`。

jev-lintのキーはGit除外済み `.env` に `TYPESAFE_API_KEY` として置ける。コードと指針は外部APIに送られる。秘密情報とNotion資料は送信対象外。warningは判断候補として読み、通信失敗を成功扱いしない。詳しくは [レビュー方法](docs/quality-review.md)。

## 開発の基準と記録

- [コーディング指針](docs/coding-guidelines.md)
- [リファレンス実装](docs/reference-implementation.md)：実際に使うAgentモジュール
- [要件照合](docs/requirements.md)：Notionの全体構想と未完了項目
- [継続実装計画](docs/superpowers/plans/2026-10-04-typescript-kernel.md)
- [作業ログ](docs/work-log.md)

次の検証単位は、Taskの作成・取得・状態保存をCLIで一周させること。
