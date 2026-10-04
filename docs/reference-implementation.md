# Agentモジュールのリファレンス実装

TypeScriptのAgent登録・一覧表示を、このKernelの最初のお手本として使う。独立したサンプルにコードをコピーせず、実際にCLIとテストから使用する製品コードを参照する。今後のモジュールは[コーディング指針](coding-guidelines.md)とこの構造を基本とする。

## 登録の流れ

```text
CLIで引数を検証
  → UUID・時刻・SQLite Adapterを配線
  → registerAgent(Port, 入力, Identity)
  → createAgent(入力, Identity) で純粋に判断
  → Port.insert(Agent) で保存
  → CLIが結果・失敗を表示
```

| 参照するコード | 責務 | 変更時に守ること |
|---|---|---|
| [domain.ts](../src/agents/domain.ts) | Agent/入力/Identityの型と入力値の検証 | Node・DB・時計へ依存せず、供給された値を保持する |
| [port.ts](../src/agents/port.ts) | 永続化に必要な操作の契約 | SQLiteの型を公開しない |
| [service.ts](../src/agents/service.ts) | domain判断と保存の順序 | 具体Adapterや秘密情報を知らない |
| [sqlite.ts](../src/agents/sqlite.ts) | agentsテーブルの所有・SQL・接続の解放 | bind、制約、既存DBとの互換性を維持する |
| [cli.ts](../src/cli.ts) | 引数・依存の配線・表示・終了コード | 引数エラーはDB作成前に検出する |

`Agent.createdAt` はTypeScript内部で使う名前。SQLiteとCLIのJSONは初期Python版の `created_at` を維持する。表示上の命名とdomain型を同じにするために既存データを書き換えない。

## テストから学ぶ

- [agent-domain.test.ts](../tests/agent-domain.test.ts)：DBのセットアップなしで入力・ID・時刻を検証する。
- [agent-sqlite.test.ts](../tests/agent-sqlite.test.ts)：本物のSQLiteで初期schemaとの互換性、入力拒否、制約エラーを検証する。
- [cli.test.ts](../tests/cli.test.ts)：一時HOME/DBを使い、別プロセスの登録→一覧で永続化を検証する。
- [quality-ast.test.ts](../tests/quality-ast.test.ts)：ASTルールに植えた違反を検出し、対応ルールなしの空実行を成功にしない。

追加機能では、まず操作するユーザーが観測できる失敗e2eを作る。その中の複雑な判断はunit、保存の不変条件はintegrationに分ける。I/Oをモックするより、可能なら一時DB・ローカルプロセスを使う。

## 次の実装への適用

Taskでは遷移の可否を `tasks/domain.ts` の純粋関数にし、現在状態・依存状態を入力として渡す。Taskと状態履歴の保存はTaskProviderのAdapter内で一つのトランザクションにする。Agent参照はAgentの公開Portを使い、tasksからagentsのSQLiteを直接importしない。

このリファレンスはAgent registryの例であり、daemon・LLM・Sandbox・Workflowまで完成したことを示すものではない。全体の進捗は[要件照合](requirements.md)で追跡する。
