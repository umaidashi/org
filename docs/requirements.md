# Notionとの要件照合

## 目的と完了条件

ユーザーの継続目標：Notionを確認しながら、実装すべきことがなくなるところまで進める。言語はTypeScript。e2e・各種テストを設定し、TDDで動作とデグレ防止を確認する。

全体の目標をAgent一覧だけに縮小しない。以下の要件ごとに実際のコード・テスト・実行結果を照合し、証拠がない項目は未完了とする。参照したNotionの11ページを `docs/notion/` に保存した。変更時はNotionを再取得する。

| 領域 | 必要な動作・不変条件 | 現在の証拠・状況 |
|---|---|---|
| 言語 | TypeScript、型検査、unit/integration/e2e、再現可能なセットアップ | TSへ移行済み。strict型検査・lint・AST・unit/integration/e2eを設定。24テストのローカル実行で検証 |
| Agent | 永続Identity、role、reportsTo、runtime、capabilities、permissions、memoryPolicy | TSのID・name・role・runtime・createdAtを実装・検証。組織/権限/Memory属性は未完了 |
| 組織 | Chief of Staffから専門Agentへの委譲 | 未完了 |
| A2A | delegate/request/result/question/decision/blocker/cancel、correlation、Task参照 | 未完了 |
| Room | Direct/Group/Agent/Task、同じAgentの複数Room、参加者・archive | 未完了 |
| Message | Roomごとの永続履歴、replyTo・sender・metadata | 未完了 |
| Activation | coordinator既定、直接mention、mention_only/all/rule_based | 未完了 |
| Session | Room/Identityとの分離、start/send/resume/stop、履歴から再構築 | 未完了 |
| Memory | semantic/episodic/procedural/relational、scope、根拠参照、confidence | 未完了 |
| Memory更新 | extraction、dedup、conflict、supersede/invalidate、原履歴不変 | 未完了 |
| Context | scope・type・tags/entity・recency・importance・full-textの選択、ContextBuilder | 未完了 |
| Task | WorkItemと内部ExecutionTaskの分離、依存・owner・親・成果物 | 未完了 |
| Task状態 | pending/assigned/running/blocked/waiting_approval/completed/failed | 未完了 |
| TaskProvider | create/get/update/list/addComment/linkArtifact、Localと外部Adapter | 未完了 |
| Event | 不変event log、受信者から独立したpublish、イベントとTaskの分離 | 未完了 |
| Subscription | pattern・filter・enabled、Agent/Workflowへのルーティング | 未完了 |
| Trigger | manual/internal/event/webhook/schedule | 未完了 |
| Daemon | ローカルAPI/socket、polling、process管理、execution状態、retry/timeout | 未完了 |
| Scheduler | 定期実行、Agent wake-up、再起動後の整合性 | 未完了 |
| Runtime | Claude Code/Codex CLI Adapter、role/instruction injection | 未完了 |
| Sandbox | local process/Docker、checkout/mount、資格情報の限定注入、destroy | 未完了 |
| Artifact | 回収・永続参照・Taskとの関連付け | 未完了 |
| Workflow | n8n invoke/status/cancel、Task/Agentから分離 | 未完了 |
| Permission | read/write/delegate/approve/spend/publish/contact/shell/networkを実行境界で制約 | 未完了 |
| Approval | 送信・deploy・削除・契約・支出・権限変更で待機し承認後に実行 | 未完了 |
| Audit | actor/task/event/tool/input-output/timestamp/result/approvalの参照 | 未完了 |
| 実行安全性 | idempotency/retry/timeout/concurrency/cancel/secret redaction | 未完了 |
| CLI | daemon/agent/room/task/workflow/event/sandbox/logs/tui | AgentのTS版を実装・検証。その他は未完了 |
| TUI | Agent/Room/Task/Eventの監視と対話 | 未完了 |
| 外部連携 | Linear TaskProvider、GitHub Event、Notion knowledge/docs | 未完了 |
| Ports | Agent/Memory/Task/Workflow/Event/Scheduler/Sandbox/SecretStoreの交換可能性 | 未完了 |
| 運営の実務e2e | Issue→委譲→実装→テスト→レビュー→Draft PR→人間判断→記憶 | 未完了 |
| ログ | 依頼・承認・判断・変更・テスト結果をリポジトリ/Gitへ記録 | `docs/work-log.md`、Notion snapshot、RED/GREEN、実jevレビューを記録。継続する |

## 実装順

1. TSへ移行し既存Agent e2eを維持。既存SQLiteデータを読めることを検証。
2. Task・Execution・Room・Message・Event・Subscriptionの永続化とCLIを小さく検証。
3. ローカルdaemonと決定論的なイベント→Task処理、実行の状態遷移・安全性。
4. Runtime/Session、MemoryとContext、coordinator・A2A。
5. Scheduler、Sandbox・Artifact、Workflow、Permission・Approval・Audit。
6. 外部AdapterとCLI/TUI、実務の一周を実サービスまで検証。

実サービスの資格情報が不足する場合は、ローカル実装とcontract testsを進め、実サービスで未検証の部分を分けて記録する。モックの成功を実サービスの成功とは扱わない。

## 対象外（Notionに明記）

重いGUI、独自LLM provider、独自vector DB、Kafka等の大規模基盤、独自Workflow designer、完全な外部A2A protocol。NATS/Redisは必要性が確認できた時にAdapterとして追加する。

## 追加された品質要件（2026-10-04）

- Voicy記事を参考に、実際のAgentモジュールをリファレンスとし、人間も読むコーディング指針を定める。実装済み：`docs/reference-implementation.md`、`docs/coding-guidelines.md`。
- 型・lint・AST・jev-lintで生成物をレビューする。実装済み：strict TSC、type-aware ESLint、fixture付きAST、指針をcontextにしたjev rule。実APIの判定も実行済み。結果と指摘の扱いはverificationに記録。
- GHAは使わず全てローカルで行う。Lefthookのpre-commitでindexの静的検査、pre-pushで全push対象treeの全検査・意味レビュー。Agentは作業中にRED/GREENと全テストを実行する。実装・hook設定済み。実際のhook実行結果は作業ログへ記録する。
- APIキーはユーザーが `.env` に設定し使用を許可。`.env` はGit除外、値は出力しない。
